// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { afterEach, describe, expect, test } from 'bun:test'
import {
  classifyDevice,
  type DeviceSignals,
  isSoftwareRenderer,
  readDeviceSignals,
} from './device-tier'

const desktop = (gpu: string, extra: Partial<DeviceSignals> = {}): DeviceSignals => ({
  backend: 'webgpu',
  gpu: gpu.toLowerCase(),
  fallbackAdapter: false,
  memoryGb: 8,
  cores: 8,
  touch: false,
  screenShortSide: 1080,
  mac: false,
  ...extra,
})

describe('device quality tier', () => {
  test('Low: no WebGPU, software rendering, little memory, phones, old Intel graphics', () => {
    expect(classifyDevice(desktop('nvidia geforce rtx 4070', { backend: 'webgl' }))).toBe('low')
    expect(classifyDevice(desktop('Google SwiftShader'))).toBe('low')
    expect(classifyDevice(desktop('', { fallbackAdapter: true }))).toBe('low')
    expect(classifyDevice(desktop('intel iris xe', { memoryGb: 4 }))).toBe('low')
    expect(classifyDevice(desktop('apple gpu', { touch: true, screenShortSide: 393 }))).toBe('low')
    expect(
      classifyDevice(desktop('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)')),
    ).toBe('low')
    expect(classifyDevice(desktop('intel gen-9'))).toBe('low')
  })

  test('High: discrete GPUs and Apple Pro/Max/Ultra', () => {
    expect(classifyDevice(desktop('nvidia ampere ANGLE (NVIDIA GeForce RTX 3070)'))).toBe('high')
    expect(classifyDevice(desktop('ANGLE (AMD, AMD Radeon RX 7800 XT)'))).toBe('high')
    expect(classifyDevice(desktop('intel Intel(R) Arc(TM) A770 Graphics'))).toBe('high')
    expect(
      classifyDevice(desktop('apple metal-3 ANGLE Metal Renderer: Apple M2 Pro', { mac: true })),
    ).toBe('high')
    // Safari hides the model: a 10+ core Mac counts as a Pro/Max chip.
    expect(classifyDevice(desktop('apple gpu', { mac: true, cores: 12 }))).toBe('high')
  })

  test('Medium: tablets, integrated GPUs, base Apple M chips, and the unknown', () => {
    expect(classifyDevice(desktop('apple gpu', { touch: true, screenShortSide: 820 }))).toBe(
      'medium',
    )
    expect(classifyDevice(desktop('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)'))).toBe('medium')
    expect(classifyDevice(desktop('ANGLE (AMD, AMD Radeon(TM) Graphics)'))).toBe('medium')
    expect(
      classifyDevice(desktop('ANGLE Metal Renderer: Apple M1, Unspecified Version', { mac: true })),
    ).toBe('medium')
    expect(classifyDevice(desktop('apple gpu', { mac: true, cores: 8 }))).toBe('medium')
    expect(classifyDevice(desktop('qualcomm adreno x1-85'))).toBe('medium')
    expect(classifyDevice(desktop(''))).toBe('medium')
  })

  test('software renderers are told apart from GPUs (their frame rate is capped)', () => {
    expect(isSoftwareRenderer(desktop('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))'))).toBe(
      true,
    )
    expect(isSoftwareRenderer(desktop('llvmpipe (LLVM 17.0.6, 256 bits)'))).toBe(true)
    expect(isSoftwareRenderer(desktop('', { fallbackAdapter: true }))).toBe(true)
    expect(isSoftwareRenderer(desktop('ANGLE Metal Renderer: Apple M2 Pro'))).toBe(false)
    expect(isSoftwareRenderer(desktop('NVIDIA GeForce RTX 3070', { backend: 'webgl' }))).toBe(false)
  })
})

describe('readDeviceSignals', () => {
  const scope = globalThis as Record<string, unknown>
  const saved = ['window', 'navigator', 'document'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(scope, key)] as const,
  )
  afterEach(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(scope, key, descriptor)
      else delete scope[key]
    }
  })

  /** A Mac page whose WebGL2 context names the GPU; returns how often a context was asked for. */
  function page(userAgent: string) {
    const contexts: string[] = []
    const gl = {
      RENDERER: 1,
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : null,
      getParameter: () => 'ANGLE Metal Renderer: Apple M2 Pro',
    }
    const define = (key: string, value: unknown) =>
      Object.defineProperty(scope, key, { value, configurable: true, writable: true })
    define('window', {
      matchMedia: () => ({ matches: false }),
      screen: { width: 1440, height: 900 },
    })
    define('navigator', {
      userAgent,
      platform: 'MacIntel',
      maxTouchPoints: 0,
      hardwareConcurrency: 8,
    })
    define('document', {
      createElement: () => ({
        getContext: (id: string) => {
          contexts.push(id)
          return gl
        },
      }),
    })
    return contexts
  }
  const device = { adapterInfo: { vendor: 'apple', architecture: 'metal-3' } }

  test('in acde with WebGPU ready, reads only the adapter and never asks for a WebGL context', () => {
    const contexts = page(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) acdert/0.0.11',
    )
    expect(readDeviceSignals('webgpu', device).gpu).toBe('apple metal-3')
    expect(contexts).toEqual([])
  })

  test('in a browser, adds the WebGL renderer string to the adapter info', () => {
    const contexts = page(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    )
    expect(readDeviceSignals('webgpu', device).gpu).toBe(
      'apple metal-3 angle metal renderer: apple m2 pro',
    )
    expect(contexts).toEqual(['webgl2'])
  })
})
