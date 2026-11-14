import { describe, expect, test } from 'bun:test'
import { sha256 } from './client'

describe('sha256', () => {
  test('without crypto.subtle it returns the same hash', async () => {
    const bytes = new TextEncoder().encode('export default () => new THREE.Group()')
    const native = await sha256(bytes)
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true })
    let fallback: string
    try {
      fallback = await sha256(bytes)
    } finally {
      delete (crypto as { subtle?: unknown }).subtle
    }
    expect(typeof crypto.subtle.digest).toBe('function')
    expect(native).toMatch(/^[0-9a-f]{64}$/)
    expect(fallback).toBe(native)
  })
})
