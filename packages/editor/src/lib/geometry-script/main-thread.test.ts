import { afterEach, describe, expect, test } from 'bun:test'
import { sha256Hex } from '@pascal-app/geometry-script/sha256'
import { compileGeometryScriptInWorker } from './client'
import { compileGeometryScriptOnMainThread } from './main-thread'

const BOX = `
import * as THREE from 'three'
export default function build() {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
  return g
}
`

const PROBE = `
export default function build() {
  throw new Error('seen:' + [typeof fetch, typeof window, typeof document, typeof globalThis].join(','))
}
`

const scope = globalThis as { Worker?: unknown }
const originalWorker = scope.Worker

afterEach(() => {
  scope.Worker = originalWorker
  delete (crypto as { subtle?: unknown }).subtle
})

describe('compileGeometryScriptInWorker without Web Workers (acde)', () => {
  test('compiles on this thread and still sets its own hashes without crypto.subtle', async () => {
    delete scope.Worker
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true })

    const output = await compileGeometryScriptInWorker({ code: BOX })

    expect(output.glb.byteLength).toBeGreaterThan(0)
    expect(output.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(output.script).toMatch(/^[0-9a-f]{64}$/)
    expect(output.sha256).toBe(sha256Hex(output.glb))
    expect(output.script).toBe(sha256Hex(new TextEncoder().encode(BOX)))
    expect(output.language).toBe('three')
  })

  test('runs the script with the ambient capabilities shadowed', async () => {
    delete scope.Worker
    await expect(compileGeometryScriptInWorker({ code: PROBE })).rejects.toThrow(
      'seen:undefined,undefined,undefined,undefined',
    )
  })

  test('the source guard still applies', async () => {
    delete scope.Worker
    await expect(
      compileGeometryScriptInWorker({ code: 'export default () => eval("1")' }),
    ).rejects.toThrow('cannot use dynamic import, eval')
  })
})

describe('compileGeometryScriptOnMainThread', () => {
  test('a timeout reports that it stopped waiting, not that the script stopped', async () => {
    const HANGS = `
export default async function build() {
  await new Promise(() => {})
}
`
    await expect(compileGeometryScriptOnMainThread({ code: HANGS }, 50)).rejects.toThrow(
      'Timed out after 0.05 s waiting for the script; it may still be running',
    )
  })
})
