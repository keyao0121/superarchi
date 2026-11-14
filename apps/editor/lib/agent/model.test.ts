import { describe, expect, test } from 'bun:test'
import { ModelError, openAiCompatibleModel } from './model'

const settings = { baseUrl: 'https://model.example/v1/', model: 'm-1', apiKey: 'secret' }

function answering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('openAiCompatibleModel', () => {
  test('sends the conversation and tools as chat completions and reads tool calls back', async () => {
    const { calls, fetchImpl } = answering(200, {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'add_wall', arguments: '{"a":1}' } },
            ],
          },
        },
      ],
    })
    const reply = await openAiCompatibleModel(settings, fetchImpl).complete({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c0', name: 'get_walls', arguments: '{}' }],
        },
        { role: 'tool', toolCallId: 'c0', content: '[]' },
      ],
      tools: [{ name: 'add_wall', description: 'Adds a wall', parameters: { type: 'object' } }],
      signal: new AbortController().signal,
    })

    expect(reply).toEqual({
      content: '',
      toolCalls: [{ id: 'c1', name: 'add_wall', arguments: '{"a":1}' }],
    })
    expect(calls[0]?.url).toBe('https://model.example/v1/chat/completions')
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer secret' })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'm-1',
      stream: false,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c0', type: 'function', function: { name: 'get_walls', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c0', content: '[]' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'add_wall',
            description: 'Adds a wall',
            parameters: { type: 'object' },
          },
        },
      ],
    })
  })

  test('leaves tools out of a request that offers none', async () => {
    const { calls, fetchImpl } = answering(200, { choices: [{ message: { content: 'ok' } }] })
    const reply = await openAiCompatibleModel(settings, fetchImpl).complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: new AbortController().signal,
    })
    expect(reply).toEqual({ content: 'ok', toolCalls: [] })
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty('tools')
  })

  test('reports a refused request with its status and reason', async () => {
    const { fetchImpl } = answering(401, 'bad key')
    const failure = openAiCompatibleModel(settings, fetchImpl).complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: new AbortController().signal,
    })
    expect(failure).rejects.toBeInstanceOf(ModelError)
    expect(failure).rejects.toMatchObject({ status: 401, message: 'HTTP 401: bad key' })
  })

  test('reports an answer without a message', async () => {
    const { fetchImpl } = answering(200, { choices: [] })
    expect(
      openAiCompatibleModel(settings, fetchImpl).complete({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ModelError)
  })
})
