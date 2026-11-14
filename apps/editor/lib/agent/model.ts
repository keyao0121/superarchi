import type { AgentModelSettings } from './settings'

export interface ModelTool {
  name: string
  description: string
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>
}

export interface ModelToolCall {
  id: string
  name: string
  /** The arguments as the model wrote them: a JSON object, or text that failed to parse. */
  arguments: string
}

export type ModelMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ModelReply {
  content: string
  toolCalls: ModelToolCall[]
}

export interface ChatModel {
  complete(request: {
    messages: ModelMessage[]
    tools: ModelTool[]
    signal: AbortSignal
  }): Promise<ModelReply>
}

/** A reply the endpoint refused or could not give: `status` 0 is a network failure. */
export class ModelError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(status ? `HTTP ${status}: ${detail}` : detail)
    this.name = 'ModelError'
  }
}

const REQUEST_TIMEOUT_MS = 180_000

type WireMessage = {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
}

function toWire(message: ModelMessage): WireMessage {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

/**
 * The chat completions call every OpenAI-compatible provider answers: one
 * request, no streaming, tools offered as functions. Only what all of them
 * share is sent, so no `tool_choice`, `response_format` or sampling options.
 */
export function openAiCompatibleModel(
  settings: AgentModelSettings,
  fetchImpl: typeof fetch = fetch,
): ChatModel {
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`
  return {
    async complete({ messages, tools, signal }) {
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify({
            model: settings.model,
            messages: messages.map(toWire),
            ...(tools.length
              ? {
                  tools: tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                }
              : {}),
            stream: false,
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        })
      } catch (error) {
        if (signal.aborted) throw error
        throw new ModelError(0, error instanceof Error ? error.message : String(error))
      }
      const text = await response.text()
      if (!response.ok) throw new ModelError(response.status, text.slice(0, 400))

      let message: WireMessage | undefined
      try {
        message = (JSON.parse(text) as { choices?: { message?: WireMessage }[] }).choices?.[0]
          ?.message
      } catch {
        message = undefined
      }
      if (!message) throw new ModelError(response.status, `no message in: ${text.slice(0, 400)}`)

      return {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls: (message.tool_calls ?? []).map((call, index) => ({
          id: call.id || `call_${index}`,
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? '{}',
        })),
      }
    },
  }
}
