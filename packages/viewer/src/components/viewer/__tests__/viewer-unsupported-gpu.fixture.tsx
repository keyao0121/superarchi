import { afterAll, afterEach, beforeAll, expect, mock, test } from 'bun:test'
import { useEffect } from 'react'

// The real <Viewer> on a runtime with no WebGPU and no WebGL. R3F's <Canvas>
// only runs the `gl` factory it is given, the fallback records what it was
// asked to show, and WebGPURenderer counts constructions.
type GlFactory = (props: { canvas: unknown }) => unknown

const probeContexts: string[] = []
const probeCanvas = {
  getContext: (contextId: string) => {
    probeContexts.push(contextId)
    return null
  },
}

let canvasMounts = 0
const fiber = await import('@react-three/fiber')
mock.module('@react-three/fiber', () => ({
  ...fiber,
  Canvas: ({ gl }: { gl: GlFactory }) => {
    useEffect(() => {
      canvasMounts += 1
      // Installed only now: the test renderer builds its own mock canvas when
      // `document.createElement` is missing, and the viewer's WebGL probe is
      // the only later caller.
      Object.assign(globalThis.document, { createElement: () => probeCanvas })
      void gl({ canvas: { id: 'display-canvas' } })
    }, [gl])
    return null
  },
}))

let rendererConstructions = 0
const three = await import('three/webgpu')
mock.module('three/webgpu', () => ({
  ...three,
  WebGPURenderer: class extends three.WebGPURenderer {
    constructor(...args: ConstructorParameters<typeof three.WebGPURenderer>) {
      rendererConstructions += 1
      super(...args)
    }
  },
}))

const fallbackReasons: (string | undefined)[] = []
mock.module('../unsupported-gpu-fallback', () => ({
  UnsupportedGpuViewerFallback: ({ reason }: { reason?: string }) => {
    fallbackReasons.push(reason)
    return null
  },
}))

const { act, create } = await import('@react-three/test-renderer')
const { default: Viewer } = await import('../index')

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const ACDERT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) acdert/0.0.11'

const STUBBED = [
  'window',
  'document',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'addEventListener',
  'removeEventListener',
  'matchMedia',
  'reportError',
  'location',
  'localStorage',
] as const
const saved = new Map<string, PropertyDescriptor | undefined>()
const quiet = { error: console.error, warn: console.warn, log: console.log }
const errors: unknown[][] = []
const warnings: unknown[][] = []

function setGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

function useUserAgent(userAgent: string) {
  // No `gpu`: WebGPU is absent.
  setGlobal('navigator', { userAgent })
}

beforeAll(() => {
  for (const key of STUBBED) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  const listeners = { addEventListener: () => {}, removeEventListener: () => {} }
  Object.assign(globalThis, {
    ...listeners,
    matchMedia: () => ({ matches: false, ...listeners }),
    reportError: () => {},
    location: { search: '', hash: '', href: 'http://localhost/' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  })
  setGlobal('window', globalThis)
  setGlobal('document', {
    ...listeners,
    visibilityState: 'visible',
    hidden: false,
  })
  console.error = (...args: unknown[]) => errors.push(args)
  console.warn = (...args: unknown[]) => warnings.push(args)
  console.log = () => {}
})

afterEach(() => {
  Reflect.deleteProperty(globalThis.document, 'createElement')
  probeContexts.length = 0
  fallbackReasons.length = 0
  errors.length = 0
  warnings.length = 0
  canvasMounts = 0
  rendererConstructions = 0
})

afterAll(() => {
  for (const key of STUBBED) {
    const descriptor = saved.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  Object.assign(console, quiet)
})

async function renderUnsupportedViewer() {
  const ready: boolean[] = []
  const renderer = await create(
    <Viewer disablePostFx onSceneReadyChange={(value) => ready.push(value)} />,
  )
  for (let i = 0; i < 5 && fallbackReasons.length === 0; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return { ready, renderer }
}

const loggedText = (calls: unknown[][]) => calls.map((args) => String(args[0]))

test('acde without WebGPU: platform notice, no WebGL probe, no renderer, ready at once', async () => {
  useUserAgent(ACDERT_UA)
  const { ready, renderer } = await renderUnsupportedViewer()

  expect(fallbackReasons.at(-1)).toBe('platform')
  expect(ready.at(-1)).toBe(true)
  expect(probeContexts).toEqual([])
  expect(rendererConstructions).toBe(0)
  expect(canvasMounts).toBe(1)
  expect(loggedText(errors)).not.toContain('[viewer] WebGPURenderer init failed')
  expect(loggedText(warnings)).toContain(
    '[viewer] WebGPU is unavailable in this acde runtime; the 3D view is off.',
  )
  await renderer.unmount()
})

test('a browser with neither WebGPU nor WebGL keeps its notice, probe and error log', async () => {
  useUserAgent(CHROME_UA)
  const { ready, renderer } = await renderUnsupportedViewer()

  expect(fallbackReasons.at(-1)).toBe('browser')
  expect(ready.at(-1)).toBe(true)
  expect(probeContexts).toEqual(['webgl2'])
  expect(rendererConstructions).toBe(0)
  expect(loggedText(errors)).toContain('[viewer] WebGPURenderer init failed')
  await renderer.unmount()
})
