import { afterEach, describe, expect, test } from 'bun:test'
import {
  compileGeometryScriptInWorker,
  compileInSandbox,
  compileOnMainThread,
  defaultGeometryScriptCompiler,
} from './client'

const BOX = `
import * as THREE from 'three'
export default function build() {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
}
`

const scope = globalThis as { Worker?: unknown; document?: unknown }
const originalWorker = Object.getOwnPropertyDescriptor(scope, 'Worker')
const originalDocument = Object.getOwnPropertyDescriptor(scope, 'document')

function restore(name: 'Worker' | 'document', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(scope, name, descriptor)
  else delete scope[name]
}

afterEach(() => {
  restore('Worker', originalWorker)
  restore('document', originalDocument)
})

/** A document that records what the compile asks of it and refuses to build anything. */
function recordingDocument() {
  const created: string[] = []
  scope.document = {
    createElement: (tag: string) => {
      created.push(tag)
      throw new Error(`created <${tag}>`)
    },
  }
  return created
}

describe('defaultGeometryScriptCompiler', () => {
  test('with Worker: the sandboxed frame and its worker, as upstream', () => {
    scope.Worker = originalWorker?.value ?? class {}
    expect(defaultGeometryScriptCompiler()).toBe(compileInSandbox)
  })

  test('without Worker (acde): this thread', () => {
    delete scope.Worker
    expect(defaultGeometryScriptCompiler()).toBe(compileOnMainThread)
  })
})

describe('compileGeometryScriptInWorker', () => {
  test('with Worker: starts the sandbox frame and never compiles on this thread', async () => {
    scope.Worker = originalWorker?.value ?? class {}
    const created = recordingDocument()
    await expect(compileGeometryScriptInWorker({ code: BOX })).rejects.toThrow('created <iframe>')
    expect(created).toEqual(['iframe'])
  })

  test('with Worker outside a browser: fails as upstream does', async () => {
    scope.Worker = originalWorker?.value ?? class {}
    delete scope.document
    await expect(compileGeometryScriptInWorker({ code: BOX })).rejects.toThrow(
      'Geometry scripts compile in a browser',
    )
  })

  test('without Worker: compiles here and builds no frame', async () => {
    delete scope.Worker
    const created = recordingDocument()
    const output = await compileGeometryScriptInWorker({ code: BOX })
    expect(output.glb.byteLength).toBeGreaterThan(0)
    expect(output.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(created).toEqual([])
  })
})
