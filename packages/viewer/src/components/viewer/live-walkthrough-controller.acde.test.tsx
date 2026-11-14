import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LiveWalkthroughController, useFirstPersonHud, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { PerspectiveCamera } from 'three'

// The real controller in acde, where `requestPointerLock` exists but throws:
// drag looks, nothing locks, and only Esc leaves.
const ACDERT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) acdert/0.0.11'
const originalGlobals = new Map(
  [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
)
let documentEvents: EventTarget & { activeElement: unknown; pointerLockElement: unknown }
let canvasEvents: EventTarget
let lockRequests = 0
let renderer: Awaited<ReturnType<typeof create>> | undefined

beforeEach(() => {
  documentEvents = Object.assign(new EventTarget(), {
    activeElement: null,
    pointerLockElement: null,
  })
  const requestAnimationFrame = () => 0
  const cancelAnimationFrame = () => {}
  Object.assign(globalThis, {
    document: documentEvents,
    window: Object.assign(new EventTarget(), { requestAnimationFrame, cancelAnimationFrame }),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame,
    cancelAnimationFrame,
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { userAgent: ACDERT_UA },
  })
  lockRequests = 0
  useViewer.getState().setWalkthroughMode(false)
  useFirstPersonHud.getState().reset()
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  useViewer.getState().setWalkthroughMode(false)
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

async function mount(onExit?: () => void) {
  const camera = new PerspectiveCamera(47)
  renderer = await create(<LiveWalkthroughController onExit={onExit} />, {
    camera,
    beforeReturn: (element) => {
      canvasEvents = new EventTarget()
      Object.assign(element, {
        hasAttribute: () => true,
        focus: () => {},
        contains: () => false,
        addEventListener: canvasEvents.addEventListener.bind(canvasEvents),
        removeEventListener: canvasEvents.removeEventListener.bind(canvasEvents),
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        hasPointerCapture: () => false,
        requestPointerLock: () => {
          lockRequests += 1
          throw new DOMException('Pointer lock is not supported', 'NotSupportedError')
        },
      })
    },
  })
  await act(async () => {
    useViewer.getState().setWalkthroughMovement('drone')
    useViewer.getState().setWalkthroughMode(true)
  })
  return camera
}

function key(code: string) {
  documentEvents.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code }))
}

function pointer(type: string, x: number) {
  canvasEvents.dispatchEvent(
    Object.assign(new Event(type), {
      button: 0,
      clientX: x,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    }),
  )
}

test('dragging turns the view and nothing asks for pointer lock', async () => {
  const camera = await mount()
  await renderer!.advanceFrames(2, 1 / 60)
  const before = camera.quaternion.clone()

  await act(async () => {
    pointer('pointerdown', 100)
    pointer('pointermove', 160)
    pointer('pointerup', 160)
    documentEvents.dispatchEvent(new Event('click'))
    key('KeyP')
  })
  await renderer!.advanceFrames(2, 1 / 60)

  expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01)
  expect(lockRequests).toBe(0)
})

test('an unlock event does not leave; Escape does, once', async () => {
  let exits = 0
  await mount(() => {
    exits += 1
  })
  await act(async () => documentEvents.dispatchEvent(new Event('pointerlockchange')))
  expect(exits).toBe(0)
  expect(useViewer.getState().walkthroughMode).toBe(true)

  await act(async () => key('Escape'))
  expect(exits).toBe(1)
  expect(useViewer.getState().walkthroughMode).toBe(false)
  expect(lockRequests).toBe(0)
})
