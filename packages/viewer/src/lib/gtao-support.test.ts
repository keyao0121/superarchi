import { describe, expect, test } from 'bun:test'
import { gtaoSupported } from './gtao-support'

describe('gtaoSupported', () => {
  test('is false on a WebGPU device in compatibility mode', () => {
    expect(gtaoSupported({ backend: { compatibilityMode: true } })).toBe(false)
  })

  test('is true on a core WebGPU device', () => {
    expect(gtaoSupported({ backend: { compatibilityMode: false } })).toBe(true)
  })

  test('is true before the backend has decided, or on a backend without the notion', () => {
    expect(gtaoSupported({ backend: { compatibilityMode: null } })).toBe(true)
    expect(gtaoSupported({ backend: {} })).toBe(true)
    expect(gtaoSupported({})).toBe(true)
  })
})
