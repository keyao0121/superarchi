import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { digestScene, type SceneDigest } from './digest'
import {
  BOSS_PROMPT,
  type CheckReport,
  checkReportSchema,
  DISPATCH_TASKS_TOOL,
  type DispatchedTasks,
  dispatchTasksSchema,
  EMPLOYEE_PROMPTS,
  EMPLOYEE_TOOLS,
  REPORT_CHECK_TOOL,
} from './employees'
import { SCENE_HOST_BUNDLE } from './host-bundle'
import {
  type ChatModel,
  ModelError,
  type ModelMessage,
  type ModelTool,
  openAiCompatibleModel,
} from './model'
import type { SceneHost, SceneHostTool } from './scene-host'
import { type AgentSession, agentSession } from './session'
import { readModelSettings } from './settings'
import type { AgentTask, EmployeeId } from './types'

type SceneNodes = Parameters<typeof digestScene>[0]

/** The scene host plus what a run needs of it: one scene at a time. */
interface TeamHost {
  scene: SceneHost
  tools: Map<string, SceneHostTool>
  /** The project whose run holds the host: its session carries one scene at a time. */
  busyWith: string | null
}

const MAX_EMPLOYEE_STEPS = 30
const MAX_TOOL_RESULT_CHARS = 12_000
const MAX_REWORK_ROUNDS = 1
const VERSION_CONFLICT = 'live_sync_version_conflict'

/**
 * Imports the scene host's own bundle, which Next must not bundle (see
 * `scene-host.ts`): a variable specifier leaves the import to the runtime.
 * `PASCAL_AGENT_HOST` names the bundle; else it sits in the app directory,
 * the working directory of `next dev` and of the standalone server alike.
 */
async function createTeamHost(): Promise<TeamHost> {
  const bundle = process.env.PASCAL_AGENT_HOST || path.join(process.cwd(), SCENE_HOST_BUNDLE)
  if (!existsSync(bundle)) {
    throw new Error(`${bundle} is missing: run \`bun run acde:prepare\` in apps/editor`)
  }
  const specifier = pathToFileURL(bundle).href
  const module = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ specifier
  )) as {
    createSceneHost: () => Promise<SceneHost>
  }
  const scene = await module.createSceneHost()
  return { scene, tools: new Map(scene.tools.map((tool) => [tool.name, tool])), busyWith: null }
}

/** On `globalThis` for the same reason as the sessions: one host for every route bundle. */
function teamHost(): Promise<TeamHost> {
  const scope = globalThis as { __pascalAgentHost?: Promise<TeamHost> }
  scope.__pascalAgentHost ??= createTeamHost().catch((error) => {
    scope.__pascalAgentHost = undefined
    throw error
  })
  return scope.__pascalAgentHost
}

interface ToolOutcome {
  text: string
  refused: boolean
}

async function loadScene(host: TeamHost, sceneId: string): Promise<void> {
  const loaded = await host.scene.callTool('load_scene', { id: sceneId })
  if (loaded.refused) throw new Error(`load_scene: ${loaded.text}`)
}

/**
 * A write is refused whole when the person saved the project by hand since the
 * session loaded it. The session then takes the stored scene, their edit
 * included, and the call runs again on it.
 */
async function callSceneTool(
  host: TeamHost,
  sceneId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { text, refused } = await host.scene.callTool(name, args)
      return {
        text:
          text.length > MAX_TOOL_RESULT_CHARS
            ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated: ask for less at a time]`
            : text,
        refused,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 0 && message.includes(VERSION_CONFLICT)) {
        await loadScene(host, sceneId)
        continue
      }
      return { text: JSON.stringify({ error: message, code: 'tool_failed' }), refused: true }
    }
  }
}

function sceneDigest(host: TeamHost): SceneDigest {
  return digestScene(host.scene.nodes() as SceneNodes)
}

const CHANGE_NOTE = 'changeNote'

/**
 * A tool that changes the scene is offered with one more argument: the line
 * the change list shows for the call. Asked for call by call it comes short
 * and in the person's language, where the text a model writes beside its calls
 * is its own reasoning. It is taken off before the tool runs.
 */
function modelTool(tool: SceneHostTool): ModelTool {
  if (tool.readOnly) {
    return { name: tool.name, description: tool.description, parameters: tool.parameters }
  }
  const { properties, required } = tool.parameters as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      ...tool.parameters,
      properties: {
        ...properties,
        [CHANGE_NOTE]: {
          type: 'string',
          description:
            'What this call does, shown to the person in the change list: one short phrase, under 12 words, in the language of their request.',
        },
      },
      required: [...(required ?? []), CHANGE_NOTE],
    },
  }
}

function firstLine(text: string, max = 80): string {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean)
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function sceneSummary(digest: SceneDigest): string {
  return JSON.stringify({ levels: digest.levels, rooms: digest.rooms, counts: digest.counts })
}

interface RunContext {
  session: AgentSession
  host: TeamHost
  model: ChatModel
  signal: AbortSignal
  request: string
}

/** The boss's reading of the request: tasks to hand out, or just an answer. */
async function planRequest(
  context: RunContext,
  history: ModelMessage[],
  digest: SceneDigest,
): Promise<{ reply: string; plan: DispatchedTasks | null }> {
  const messages: ModelMessage[] = [
    { role: 'system', content: BOSS_PROMPT },
    ...history,
    {
      role: 'user',
      content: `${context.request}\n\n<scene_summary>${sceneSummary(digest)}</scene_summary>`,
    },
  ]
  // One more try when the tasks do not parse: the model gets the reason back.
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await context.model.complete({
      messages,
      tools: [DISPATCH_TASKS_TOOL],
      signal: context.signal,
    })
    const call = reply.toolCalls.find((candidate) => candidate.name === DISPATCH_TASKS_TOOL.name)
    if (!call) return { reply: reply.content, plan: null }
    const parsed = dispatchTasksSchema.safeParse(parseArguments(call.arguments))
    if (parsed.success) return { reply: parsed.data.reply, plan: parsed.data }
    messages.push(
      { role: 'assistant', content: reply.content, toolCalls: [call] },
      {
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({ error: parsed.error.message, code: 'invalid_input' }),
      },
    )
  }
  throw new ModelError(0, 'the model did not produce a valid task list')
}

interface EmployeeResult {
  note: string
  check: CheckReport | null
}

async function runEmployee(
  context: RunContext,
  task: AgentTask,
  earlier: string[],
): Promise<EmployeeResult> {
  const { session, host, model, signal } = context
  const employee: EmployeeId = task.employee
  const offered = EMPLOYEE_TOOLS[employee]
    .map((name) => host.tools.get(name))
    .filter((tool): tool is SceneHostTool => tool !== undefined)
  const tools = [...offered.map(modelTool), ...(employee === 'check' ? [REPORT_CHECK_TOOL] : [])]
  const digest = sceneDigest(host)
  const messages: ModelMessage[] = [
    { role: 'system', content: EMPLOYEE_PROMPTS[employee] },
    {
      role: 'user',
      content: [
        `The person's request: ${context.request}`,
        `Your task: ${task.title}\n${task.instructions}`,
        earlier.length ? `Done before you:\n${earlier.join('\n')}` : '',
        `<scene_summary>${sceneSummary(digest)}</scene_summary>`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]

  let check: CheckReport | null = null
  for (let step = 0; step < MAX_EMPLOYEE_STEPS; step++) {
    signal.throwIfAborted()
    const reply = await model.complete({ messages, tools, signal })
    if (reply.toolCalls.length === 0) return { note: reply.content.trim(), check }
    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls })

    // For a model that leaves the note out: what it wrote beside its calls, if that is short.
    let label = reply.content.trim().length <= 60 ? firstLine(reply.content) : ''
    for (const call of reply.toolCalls) {
      signal.throwIfAborted()
      const args = parseArguments(call.arguments)
      let result: string
      if (!args) {
        result = JSON.stringify({ error: 'arguments are not a JSON object', code: 'invalid_input' })
      } else if (call.name === REPORT_CHECK_TOOL.name && employee === 'check') {
        const report = checkReportSchema.safeParse(args)
        if (report.success) check = report.data
        result = report.success
          ? JSON.stringify({ ok: true })
          : JSON.stringify({ error: report.error.message, code: 'invalid_input' })
      } else {
        const tool = offered.find((candidate) => candidate.name === call.name)
        if (!tool) {
          result = JSON.stringify({ error: `no tool named ${call.name}`, code: 'unknown_tool' })
        } else if (tool.readOnly) {
          result = (await callSceneTool(host, session.state.sceneId, tool.name, args)).text
        } else {
          const { [CHANGE_NOTE]: note, ...toolArgs } = args
          const text = (typeof note === 'string' && firstLine(note)) || label || tool.title
          label = ''
          session.updateTask(task.id, { note: text })
          const change = session.addChange(employee, text)
          const outcome = await callSceneTool(host, session.state.sceneId, tool.name, toolArgs)
          session.updateChange(change, outcome.refused ? 'refused' : 'applied')
          if (!outcome.refused) session.set({ canRevert: true })
          result = outcome.text
        }
      }
      messages.push({ role: 'tool', toolCallId: call.id, content: result })
    }
  }
  return { note: '', check }
}

/** Sends findings back to who must fix them, then has them checked again. */
function addRework(session: AgentSession, checkTask: AgentTask, report: CheckReport): void {
  const byEmployee = new Map<EmployeeId, string[]>()
  for (const finding of report.findings) {
    byEmployee.set(finding.employee, [...(byEmployee.get(finding.employee) ?? []), finding.summary])
  }
  for (const [employee, findings] of byEmployee) {
    session.addTask({
      employee,
      title: firstLine(findings[0] ?? '', 28),
      instructions: `The check found problems to fix:\n- ${findings.join('\n- ')}`,
    })
  }
  session.addTask({
    employee: 'check',
    title: checkTask.title,
    instructions: `${checkTask.instructions}\n\nThis is the re-check after these findings were sent back:\n- ${report.findings
      .map((finding) => finding.summary)
      .join('\n- ')}`,
  })
}

async function closingReport(context: RunContext, results: string[]): Promise<string> {
  const reply = await context.model.complete({
    messages: [
      {
        role: 'system',
        content:
          'You are the Boss of a building design team. Tell the person, in one or two sentences in the language of their request, what the team did, from the task results below, and that it now waits for their acceptance. No markdown.',
      },
      {
        role: 'user',
        content: `Request: ${context.request}\n\nTask results:\n${results.join('\n')}`,
      },
    ],
    tools: [],
    signal: context.signal,
  })
  return reply.content
}

async function runRequest(context: RunContext, history: ModelMessage[]): Promise<void> {
  const { session, host } = context
  const sceneId = session.state.sceneId

  await loadScene(host, sceneId)
  // A project nobody has built in yet holds no level to build on.
  if (Object.keys(host.scene.nodes()).length === 0) host.scene.loadDefaultScene()
  session.snapshot = host.scene.snapshot()
  session.set({ canRevert: false })

  const { reply, plan } = await planRequest(context, history, sceneDigest(host))
  session.say('boss', reply)
  if (!plan) {
    session.set({ status: 'idle' })
    return
  }

  session.openBoard(plan.title, plan.tasks)
  const results: string[] = []
  let reworkRounds = 0
  // The board grows while it runs: a failed check appends the rework.
  for (let index = 0; index < (session.state.board?.tasks.length ?? 0); index++) {
    const task = session.state.board?.tasks[index]
    if (!task) break
    session.updateTask(task.id, { status: 'doing', note: '' })
    const result = await runEmployee(context, task, results)
    session.updateTask(task.id, { status: 'review', note: result.note })
    if (result.note) session.say(task.employee, result.note)
    results.push(`- ${task.title} (${task.employee}): ${result.note || 'done'}`)
    if (
      result.check &&
      !result.check.passed &&
      result.check.findings.length > 0 &&
      reworkRounds < MAX_REWORK_ROUNDS
    ) {
      reworkRounds++
      addRework(session, task, result.check)
    }
  }

  session.say('boss', await closingReport(context, results))
  session.set({ status: 'review' })
}

function conversationHistory(session: AgentSession): ModelMessage[] {
  return session.state.messages
    .filter((message) => message.author === 'user' || message.author === 'boss')
    .slice(-12)
    .map((message) => ({
      role: message.author === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.text,
    }))
}

/**
 * Starts a run for what the person said and returns at once: the session's
 * state carries the progress. A run that is still waiting for acceptance is
 * taken as accepted by the next request.
 */
export async function sendToBoss(sceneId: string, text: string): Promise<void> {
  const session = agentSession(sceneId)
  if (session.state.status === 'working') return

  const history = conversationHistory(session)
  session.say('user', text)

  const settings = await readModelSettings()
  if (!settings) {
    session.set({ status: 'error', error: 'model_not_configured', errorDetail: null })
    return
  }
  const host = await teamHost()
  if (host.busyWith && host.busyWith !== sceneId) {
    session.set({ status: 'error', error: 'busy', errorDetail: null })
    return
  }

  acceptRun(sceneId)
  host.busyWith = sceneId
  const abort = new AbortController()
  session.abort = abort
  session.set({ status: 'working', error: null, errorDetail: null })

  const context: RunContext = {
    session,
    host,
    model: openAiCompatibleModel(settings),
    signal: abort.signal,
    request: text,
  }
  void runRequest(context, history)
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      session.set({
        status: 'error',
        error: abort.signal.aborted
          ? 'stopped'
          : error instanceof ModelError
            ? 'model_failed'
            : 'failed',
        errorDetail: abort.signal.aborted ? null : detail,
      })
    })
    .finally(() => {
      host.busyWith = null
      session.abort = null
    })
}

export function stopRun(sceneId: string): void {
  agentSession(sceneId).abort?.abort()
}

/** The person accepts the work: every task that waited for review is done. */
export function acceptRun(sceneId: string): void {
  const session = agentSession(sceneId)
  const board = session.state.board
  if (session.state.status === 'working') return
  if (board) {
    for (const task of board.tasks) {
      if (task.status === 'review') session.updateTask(task.id, { status: 'done' })
    }
  }
  session.snapshot = null
  session.set({ status: 'idle', canRevert: false, error: null, errorDetail: null })
}

/** Puts the scene back as it stood before the last run, as one more live edit. */
export async function revertRun(sceneId: string): Promise<void> {
  const session = agentSession(sceneId)
  if (session.state.status === 'working' || !session.snapshot || !session.state.canRevert) return
  const host = await teamHost()
  if (host.busyWith) {
    session.set({ status: 'error', error: 'busy', errorDetail: null })
    return
  }
  host.busyWith = sceneId
  try {
    await host.scene.restore(sceneId, session.snapshot)
    session.snapshot = null
    session.set({
      status: 'idle',
      board: null,
      canRevert: false,
      error: null,
      errorDetail: null,
      changes: session.state.changes.map((change) =>
        change.status === 'applied' ? { ...change, status: 'reverted' as const } : change,
      ),
    })
  } catch (error) {
    session.set({
      status: 'error',
      error: 'failed',
      errorDetail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    host.busyWith = null
  }
}
