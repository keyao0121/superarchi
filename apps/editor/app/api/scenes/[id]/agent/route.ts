import { z } from 'zod'
import { acceptRun, revertRun, sendToBoss, stopRun } from '@/lib/agent/scene-agent'
import { agentSession } from '@/lib/agent/session'
import type { AgentState } from '@/lib/agent/types'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

const HEARTBEAT_MS = 15_000

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('message'), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('revert') }),
  z.object({ action: z.literal('stop') }),
])

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

/** The assistant's state for this project as server-sent events: the whole state on every change. */
export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!(await operations.loadStoredScene(id))) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const session = agentSession(id)
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }
      const sendState = (state: AgentState) =>
        send(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // The client may have already closed the stream.
        }
      }

      request.signal.addEventListener('abort', close, { once: true })
      send('retry: 1000\n\n')
      sendState(session.state)
      unsubscribe = session.subscribe(sendState)
      heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return withSceneApiHeaders(
    request,
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    }),
  )
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_action' }, { status: 400 })
  }
  const operations = await getSceneOperations()
  if (!(await operations.loadStoredScene(id))) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const action = parsed.data
  if (action.action === 'message') await sendToBoss(id, action.text)
  else if (action.action === 'accept') acceptRun(id)
  else if (action.action === 'revert') await revertRun(id)
  else stopRun(id)

  return sceneApiJson(request, agentSession(id).state, { status: 202 })
}
