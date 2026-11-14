import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleSceneHost } from '../../scripts/acde/agent-host'
import { type ScriptedModel, startScriptedModel } from './__fixtures__/scripted-model'
import { acceptRun, revertRun, sendToBoss } from './scene-agent'
import { agentSession } from './session'
import { writeModelSettings } from './settings'
import type { AgentState } from './types'

type Operations = import('@pascal-app/mcp/operations').SceneOperations

// Bundling the scene host takes seconds on a busy machine.
setDefaultTimeout(60_000)

const dataDir = mkdtempSync(join(tmpdir(), 'pascal-agent-'))
const previousDataDir = process.env.PASCAL_DATA_DIR
const previousHost = process.env.PASCAL_AGENT_HOST
let model: ScriptedModel
let operations: Operations

beforeAll(async () => {
  // The settings file and the scene database both follow this directory.
  process.env.PASCAL_DATA_DIR = dataDir
  // The team runs on the bundle the backend ships, built here as `acde:prepare` builds it.
  process.env.PASCAL_AGENT_HOST = join(dataDir, 'scene-host.mjs')
  await bundleSceneHost(process.env.PASCAL_AGENT_HOST)
  // From source: another test file's mock of '@pascal-app/mcp/*' can outlive that file.
  const { SqliteSceneStore } = await import(
    '../../../../packages/mcp/src/storage/sqlite-scene-store'
  )
  const { createSceneOperations } = await import(
    '../../../../packages/mcp/src/operations/scene-operations'
  )
  operations = createSceneOperations({ store: new SqliteSceneStore({ env: process.env }) })
  model = await startScriptedModel()
})

afterAll(async () => {
  await model.stop()
  if (previousDataDir === undefined) delete process.env.PASCAL_DATA_DIR
  else process.env.PASCAL_DATA_DIR = previousDataDir
  if (previousHost === undefined) delete process.env.PASCAL_AGENT_HOST
  else process.env.PASCAL_AGENT_HOST = previousHost
  rmSync(dataDir, { recursive: true })
})

function settled(sceneId: string): Promise<AgentState> {
  const session = agentSession(sceneId)
  return new Promise((resolve) => {
    const done = (state: AgentState) => {
      if (state.status === 'working') return false
      resolve(state)
      return true
    }
    if (done(session.state)) return
    const unsubscribe = session.subscribe((state) => {
      if (done(state)) unsubscribe()
    })
  })
}

async function wallCount(sceneId: string): Promise<number> {
  const stored = await operations.loadStoredScene(sceneId)
  return Object.values(stored?.graph.nodes ?? {}).filter(
    (node) => (node as { type: string }).type === 'wall',
  ).length
}

describe('the AI team', () => {
  test('asks for a model before anything else', async () => {
    const scene = await operations.saveScene({ name: 'No model', graph: emptyGraph() })
    await sendToBoss(scene.id, '加一道隔墙')
    expect(agentSession(scene.id).state).toMatchObject({
      status: 'error',
      error: 'model_not_configured',
      messages: [{ author: 'user', text: '加一道隔墙' }],
    })
  })

  test('plans, builds, checks, then waits to be accepted or reverted', async () => {
    await writeModelSettings({ baseUrl: model.baseUrl, model: 'scripted', apiKey: 'test-key' })
    // A project nobody has built in: the team starts it from the default scaffold.
    const scene = await operations.saveScene({ name: 'Team', graph: emptyGraph() })

    await sendToBoss(scene.id, '加一道隔墙')
    const state = await settled(scene.id)

    expect(state.error).toBeNull()
    expect(state.status).toBe('review')
    expect(state.messages.map((message) => [message.author, message.text])).toEqual([
      ['user', '加一道隔墙'],
      ['boss', '收到，拆成 2 个任务。'],
      ['plan', '已加一道 2 米的隔墙。'],
      ['check', '复查通过。'],
      ['boss', '已完成，等你验收。'],
    ])
    expect(state.board?.title).toBe('加一道隔墙')
    expect(state.board?.tasks.map((task) => [task.title, task.employee, task.status])).toEqual([
      ['加隔墙', 'plan', 'review'],
      ['查碰撞', 'check', 'review'],
    ])
    // Only the write is a change; the check's reads are not.
    expect(state.changes.map((change) => [change.employee, change.text, change.status])).toEqual([
      ['plan', '新增隔墙', 'applied'],
    ])
    expect(state.canRevert).toBe(true)

    // The edit is saved and announced to the open editor.
    expect(await wallCount(scene.id)).toBe(1)
    const events = await operations.listSceneEvents(scene.id, { afterEventId: 0, limit: 10 })
    expect(events.length).toBeGreaterThan(0)

    // Each employee was offered its own trade's tools, with the key the person saved.
    const offered = (system: string) =>
      model.requests
        .find((request) => request.body.messages[0]?.content?.startsWith(system))
        ?.body.tools?.map((tool) => tool.function.name) ?? []
    expect(model.requests.every((request) => request.authorization === 'Bearer test-key')).toBe(
      true,
    )
    expect(offered('You are the Boss of a small')).toEqual(['dispatch_tasks'])
    expect(offered('You are the floor plan employee')).toContain('add_wall')
    expect(offered('You are the floor plan employee')).not.toContain('place_items')
    expect(offered('You are the checking employee')).toContain('report_check')
    expect(offered('You are the checking employee')).not.toContain('add_wall')

    // A tool that writes asks for the line the change list shows; one that reads does not.
    const planTools =
      model.requests.find((request) =>
        request.body.messages[0]?.content?.startsWith('You are the floor plan employee'),
      )?.body.tools ?? []
    const parametersOf = (name: string) =>
      planTools.find((tool) => tool.function.name === name)?.function.parameters
    expect(parametersOf('add_wall')?.required).toContain('changeNote')
    expect(parametersOf('add_wall')?.properties).toHaveProperty('changeNote')
    expect(parametersOf('get_walls')?.properties).not.toHaveProperty('changeNote')

    await revertRun(scene.id)
    expect(await wallCount(scene.id)).toBe(0)
    expect(agentSession(scene.id).state).toMatchObject({
      status: 'idle',
      board: null,
      canRevert: false,
      changes: [{ status: 'reverted' }],
    })
  })

  test('marks the work done when it is accepted', async () => {
    const scene = await operations.saveScene({ name: 'Accepted', graph: emptyGraph() })
    await sendToBoss(scene.id, '加一道隔墙')
    await settled(scene.id)

    acceptRun(scene.id)
    const state = agentSession(scene.id).state
    expect(state.status).toBe('idle')
    expect(state.board?.tasks.map((task) => task.status)).toEqual(['done', 'done'])
    expect(state.canRevert).toBe(false)
    expect(await wallCount(scene.id)).toBe(1)
  })
})

function emptyGraph() {
  return { nodes: {}, rootNodeIds: [] }
}
