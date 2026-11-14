import { describe, expect, test } from 'bun:test'
import { depthGatherSupported } from './depth-gather-support'

describe('depthGatherSupported', () => {
  test('is false on a WebGPU device in compatibility mode', () => {
    expect(depthGatherSupported({ backend: { compatibilityMode: true } })).toBe(false)
  })

  test('is true on a core WebGPU device', () => {
    expect(depthGatherSupported({ backend: { compatibilityMode: false } })).toBe(true)
  })

  test('is true before the backend has decided, or on a backend without the notion', () => {
    expect(depthGatherSupported({ backend: { compatibilityMode: null } })).toBe(true)
    expect(depthGatherSupported({ backend: {} })).toBe(true)
    expect(depthGatherSupported({})).toBe(true)
  })
})
