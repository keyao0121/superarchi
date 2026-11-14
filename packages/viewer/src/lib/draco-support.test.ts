import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  DracoUnavailableError,
  dracoDecoderPath,
  hasWebWorker,
  resetDracoWarning,
  unavailableDracoLoader,
  warnDracoUnavailable,
} from './draco-support'
import { getViewerConfig } from './viewer-config'

const scope = globalThis as Record<string, unknown>
let savedWorker: PropertyDescriptor | undefined

// Bun has Worker; acde's page runtime does not.
function removeWorker() {
  savedWorker = Object.getOwnPropertyDescriptor(scope, 'Worker')
  delete scope.Worker
}

afterEach(() => {
  if (savedWorker) Object.defineProperty(scope, 'Worker', savedWorker)
  savedWorker = undefined
})

/** A GLB whose one primitive requires KHR_draco_mesh_compression (its payload is not real Draco). */
function dracoGlb(): ArrayBuffer {
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    buffers: [{ byteLength: 4 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
    accessors: [{ componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            extensions: {
              KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } },
            },
          },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = new TextEncoder().encode(text)
  const total = 12 + 8 + jsonBytes.length + 8 + 4
  const glb = new ArrayBuffer(total)
  const view = new DataView(glb)
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  new Uint8Array(glb, 20, jsonBytes.length).set(jsonBytes)
  view.setUint32(20 + jsonBytes.length, 4, true)
  view.setUint32(24 + jsonBytes.length, 0x004e4942, true) // 'BIN'
  return glb
}

describe('feature detection', () => {
  test('with Worker: decoders as configured', () => {
    expect(hasWebWorker()).toBe(true)
    expect(dracoDecoderPath()).toBe(getViewerConfig().decoders.dracoPath)
  })

  test('without Worker: no Draco decoder path, so drei creates no DRACOLoader', () => {
    removeWorker()
    expect(hasWebWorker()).toBe(false)
    expect(dracoDecoderPath()).toBe(false)
  })
})

describe('unavailableDracoLoader', () => {
  let warn: ReturnType<typeof spyOn>
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    resetDracoWarning()
    warn = spyOn(console, 'warn').mockImplementation(() => {})
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    warn.mockRestore()
    fetchSpy.mockRestore()
  })

  test('preload fetches nothing', () => {
    expect(unavailableDracoLoader.preload()).toBe(unavailableDracoLoader)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('a decode reports DracoUnavailableError to onError and its promise settles', async () => {
    const errors: Error[] = []
    let decoded = false
    const result = unavailableDracoLoader.decodeDracoFile(
      new ArrayBuffer(4),
      () => {
        decoded = true
      },
      undefined,
      undefined,
      undefined,
      (error) => errors.push(error),
    )
    await expect(result).resolves.toBeUndefined()
    expect(decoded).toBe(false)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(DracoUnavailableError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('warns once per page with a recognizable message', async () => {
    await unavailableDracoLoader.decodeDracoFile(new ArrayBuffer(4), () => {})
    await unavailableDracoLoader.decodeDracoFile(new ArrayBuffer(4), () => {})
    warnDracoUnavailable('site flag')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toStartWith(
      '[viewer] Draco-compressed geometry cannot be decoded here: this runtime has no Web Worker.',
    )
  })

  test('warnDracoUnavailable names what was skipped', () => {
    warnDracoUnavailable('site flag')
    expect(String(warn.mock.calls[0]?.[0])).toEndWith('(site flag)')
  })

  test("three's DRACOLoader without Worker fetches the decoder, then fails on new Worker (T07)", async () => {
    removeWorker()
    // three's FileLoader reports progress with ProgressEvent, which Bun lacks.
    const hadProgressEvent = 'ProgressEvent' in scope
    if (!hadProgressEvent) scope.ProgressEvent = class extends Event {}
    try {
      const requested: string[] = []
      fetchSpy.mockImplementation((async (input: RequestInfo | URL) => {
        requested.push(input instanceof Request ? input.url : String(input))
        return new Response(new Uint8Array(8))
      }) as typeof fetch)
      const draco = new DRACOLoader()
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/')
      const loader = new GLTFLoader()
      loader.setDRACOLoader(draco)
      const error = await new Promise<unknown>((resolve, reject) =>
        loader.parse(dracoGlb(), '', () => reject(new Error('the model must not load')), resolve),
      )
      expect(String(error)).toContain('Worker is not defined')
      expect(requested.some((url) => url.includes('www.gstatic.com/draco'))).toBe(true)
    } finally {
      if (!hadProgressEvent) delete scope.ProgressEvent
    }
  })

  test('GLTFLoader without Worker: the Draco model fails cleanly, nothing is fetched', async () => {
    removeWorker()
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      const loader = new GLTFLoader()
      loader.setDRACOLoader(unavailableDracoLoader as never)
      const error = await new Promise<unknown>((resolve, reject) =>
        loader.parse(dracoGlb(), '', () => reject(new Error('the model must not load')), resolve),
      )
      expect(error).toBeInstanceOf(DracoUnavailableError)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(rejections).toEqual([])
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })
})
