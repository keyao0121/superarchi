import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AcdeWindow,
  type FullscreenHost,
  subscribeFullscreen,
  toggleFullscreen,
} from './acde-fullscreen'

const scope = globalThis as Record<string, unknown>
let previous: PropertyDescriptor | undefined
let stubbed = false

// Another test file in the run may have left a document behind: put back whatever was there.
afterEach(() => {
  if (!stubbed) return
  if (previous) Object.defineProperty(scope, 'document', previous)
  else delete scope.document
  stubbed = false
})

function fakeDocument(fullscreenElement: unknown = null) {
  const calls: string[] = []
  const listeners = new Map<string, () => void>()
  const doc = {
    fullscreenElement,
    exitFullscreen: () => calls.push('exitFullscreen'),
    documentElement: { requestFullscreen: () => calls.push('requestFullscreen') },
    addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    removeEventListener: (name: string, handler: () => void) => {
      if (listeners.get(name) === handler) listeners.delete(name)
    },
  }
  previous = Object.getOwnPropertyDescriptor(scope, 'document')
  stubbed = true
  Object.defineProperty(scope, 'document', { value: doc, configurable: true, writable: true })
  return { doc, calls, listeners }
}

function fakeWindow(state: AcdeWindow['state']) {
  const requested: string[] = []
  const handlers = new Set<(event: { state: AcdeWindow['state'] }) => void>()
  const window = {
    state,
    requestState: (next: string) => requested.push(next),
    on: (_name: 'state', handler: (event: { state: AcdeWindow['state'] }) => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  } as unknown as AcdeWindow
  const emit = (next: AcdeWindow['state']) => {
    for (const handler of handlers) handler({ state: next })
  }
  return { window, requested, handlers, emit }
}

const acde = (window: AcdeWindow | null): FullscreenHost & { loads: number } => {
  const host = {
    loads: 0,
    isAcde: () => true,
    loadWindow: async () => {
      host.loads++
      return window
    },
  }
  return host
}

const browser: FullscreenHost = {
  isAcde: () => false,
  loadWindow: () => {
    throw new Error('a browser never loads acde:window')
  },
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('toggleFullscreen in acde', () => {
  test.each([
    ['normal', 'fullscreen'],
    ['filled', 'fullscreen'],
    ['fullscreen', 'normal'],
  ] as const)('asks the window in state %s for %s', async (state, next) => {
    const { doc, calls } = fakeDocument()
    const { window, requested } = fakeWindow(state)
    toggleFullscreen(acde(window))
    await settle()
    expect(requested).toEqual([next])
    expect(calls).toEqual([])
    expect(doc.fullscreenElement).toBeNull()
  })

  test('does nothing when the runtime does not grant acde:window', async () => {
    fakeDocument()
    expect(() => toggleFullscreen(acde(null))).not.toThrow()
    await settle()
  })
})

describe('toggleFullscreen in a browser', () => {
  test('requests full screen synchronously when not in full screen', () => {
    const { calls } = fakeDocument(null)
    toggleFullscreen(browser)
    expect(calls).toEqual(['requestFullscreen'])
  })

  test('exits full screen when in full screen', () => {
    const { calls } = fakeDocument({})
    toggleFullscreen(browser)
    expect(calls).toEqual(['exitFullscreen'])
  })

  test('uses the Fullscreen API by default outside acde', () => {
    const { calls } = fakeDocument(null)
    toggleFullscreen()
    expect(calls).toEqual(['requestFullscreen'])
  })
})

describe('subscribeFullscreen in acde', () => {
  test('reports the current state, then each state event, until unsubscribed', async () => {
    fakeDocument()
    const { window, handlers, emit } = fakeWindow('normal')
    const seen: boolean[] = []
    const unsubscribe = subscribeFullscreen((fullscreen) => seen.push(fullscreen), acde(window))
    await settle()
    emit('fullscreen')
    emit('normal')
    unsubscribe()
    emit('fullscreen')
    expect(seen).toEqual([false, true, false])
    expect(handlers.size).toBe(0)
  })

  test('does not subscribe when unsubscribed before the window loads', async () => {
    fakeDocument()
    const { window, handlers } = fakeWindow('fullscreen')
    const seen: boolean[] = []
    subscribeFullscreen((fullscreen) => seen.push(fullscreen), acde(window))()
    await settle()
    expect(seen).toEqual([])
    expect(handlers.size).toBe(0)
  })

  test('does not touch fullscreenchange', async () => {
    const { listeners } = fakeDocument()
    subscribeFullscreen(() => {}, acde(fakeWindow('normal').window))
    await settle()
    expect(listeners.size).toBe(0)
  })
})

describe('subscribeFullscreen in a browser', () => {
  test('follows fullscreenchange and removes its listener', () => {
    const { doc, listeners } = fakeDocument(null)
    const seen: boolean[] = []
    const unsubscribe = subscribeFullscreen((fullscreen) => seen.push(fullscreen), browser)
    const handler = listeners.get('fullscreenchange')!
    doc.fullscreenElement = {}
    handler()
    doc.fullscreenElement = null
    handler()
    expect(seen).toEqual([true, false])
    unsubscribe()
    expect(listeners.size).toBe(0)
  })
})
