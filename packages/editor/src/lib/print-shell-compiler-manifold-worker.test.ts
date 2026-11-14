import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, WallNode } from '@pascal-app/core'
import * as THREE from 'three'
import {
  compileSemanticPrintShellWithManifold,
  defaultManifoldRunner,
  runManifoldInProcess,
  runManifoldWorker,
} from './print-shell-compiler-manifold-worker'

const scope = globalThis as { Worker?: unknown }
const originalWorker = scope.Worker

function withoutWorker() {
  delete scope.Worker
}

afterEach(() => {
  scope.Worker = originalWorker
})

function wallScene() {
  const levelId = 'level_in-process'
  const wall = WallNode.parse({
    id: 'wall_in-process',
    parentId: levelId,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
  })
  const wallRoot = new THREE.Group()
  wallRoot.userData = { pascalId: wall.id }
  const flatDisplay = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.2))
  flatDisplay.rotation.x = -Math.PI / 2
  wallRoot.add(flatDisplay)
  const source = new THREE.Group()
  source.add(wallRoot)
  const nodes: Record<string, AnyNode> = {
    [levelId]: {
      object: 'node',
      id: levelId,
      type: 'level',
      parentId: null,
      children: [wall.id],
      height: 2.5,
      level: 0,
      visible: true,
    } as unknown as AnyNode,
    [wall.id]: wall,
  }
  return { source, nodes }
}

describe('defaultManifoldRunner', () => {
  test('keeps the worker wherever Worker exists', () => {
    scope.Worker = originalWorker ?? class {}
    expect(defaultManifoldRunner()).toBe(runManifoldWorker)
  })

  test('falls back to the in-process runner without Worker', () => {
    withoutWorker()
    expect(defaultManifoldRunner()).toBe(runManifoldInProcess)
  })
})

describe('compileSemanticPrintShellWithManifold without Worker', () => {
  test('compiles in process and says so', async () => {
    withoutWorker()
    const { source, nodes } = wallScene()

    const compiled = await compileSemanticPrintShellWithManifold(source, nodes)

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    expect(compiled.status).toBe('compiled')
    expect(compiled.scene).not.toBeNull()
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'manifold_in_process_compiler',
      }),
    )
  }, 15_000)
})
