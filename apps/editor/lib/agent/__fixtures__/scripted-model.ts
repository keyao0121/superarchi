import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

type WireMessage = { role: string; content: string | null; tool_calls?: unknown[] }
type WireRequest = {
  model: string
  messages: WireMessage[]
  tools?: {
    function: {
      name: string
      parameters?: { properties?: Record<string, unknown>; required?: string[] }
    }
  }[]
}

export interface ScriptedModel {
  /** What to save as the model settings' base URL. */
  baseUrl: string
  requests: { authorization: string | null; body: WireRequest }[]
  stop(): Promise<void>
}

function toolCall(id: string, name: string, args: unknown) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }
}

/**
 * What a model would answer, decided from who is asking (the system prompt)
 * and how far that conversation has gone: the boss hands out one layout task
 * and one check, the plan employee adds a wall, the check passes.
 */
function scriptedReply(request: WireRequest): WireMessage | ReturnType<typeof toolCall> {
  const system = request.messages[0]?.content ?? ''
  const toolResults = request.messages.filter((message) => message.role === 'tool').length

  if (system.startsWith('You are the Boss of a small building design team')) {
    return toolCall('call_dispatch', 'dispatch_tasks', {
      reply: '收到，拆成 2 个任务。',
      title: '加一道隔墙',
      tasks: [
        { title: '加隔墙', employee: 'plan', instructions: 'Add a wall from [1, 1] to [3, 1].' },
        { title: '查碰撞', employee: 'check', instructions: 'Verify the new wall.' },
      ],
    })
  }
  if (system.startsWith('You are the floor plan employee')) {
    return toolResults === 0
      ? toolCall('call_wall', 'add_wall', { start: [1, 1], end: [3, 1], changeNote: '新增隔墙' })
      : { role: 'assistant', content: '已加一道 2 米的隔墙。' }
  }
  if (system.startsWith('You are the checking employee')) {
    if (toolResults === 0) return toolCall('call_verify', 'verify_scene', {})
    if (toolResults === 1) return toolCall('call_report', 'report_check', { passed: true })
    return { role: 'assistant', content: '复查通过。' }
  }
  return { role: 'assistant', content: '已完成，等你验收。' }
}

/** An OpenAI-compatible chat endpoint on loopback that plays a fixed team. */
export async function startScriptedModel(): Promise<ScriptedModel> {
  const requests: ScriptedModel['requests'] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WireRequest
      requests.push({ authorization: request.headers.authorization ?? null, body })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ index: 0, message: scriptedReply(body) }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
