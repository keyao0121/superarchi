import type { AnyNode } from '@pascal-app/core'
import * as THREE from 'three'
import {
  prepareSemanticPrintShellSource,
  type SemanticPrintCompileOptions,
} from './print-shell-compiler'
import {
  collectPrintShellInput,
  type PrintShellCompileDiagnostic,
  type PrintShellCompileResult,
} from './print-shell-compiler-baseline'
import {
  geometryFromManifoldMeshData,
  geometryToManifoldMeshData,
} from './print-shell-compiler-mesh-data'
import type {
  ManifoldCompileOutput,
  ManifoldMeshData,
  ManifoldRuntimeOptions,
  ManifoldWorkerRequest,
  ManifoldWorkerResponse,
} from './print-shell-compiler-protocol'

const WORKER_TIMEOUT_MS = 60_000

let manifoldRuntime: ManifoldRuntimeOptions | undefined

/**
 * Overrides where the print-export worker loads the manifold-3d module and
 * wasm from. See the loader in print-shell-compiler-manifold-core.ts for the
 * default resolution order; hosts with restrictive networks should call this
 * with self-hosted asset URLs before the first print export.
 */
export function configureManifoldRuntime(options: ManifoldRuntimeOptions | undefined): void {
  manifoldRuntime = options
}

export type ManifoldCompileRunner = (meshes: ManifoldMeshData[]) => Promise<ManifoldCompileOutput>

export type SemanticManifoldCompileOptions = SemanticPrintCompileOptions & {
  runner?: ManifoldCompileRunner
}

type PendingRequest = {
  resolve: (output: ManifoldCompileOutput) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

function resetWorker(error: Error) {
  worker?.terminate()
  worker = null
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
  pendingRequests.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are unavailable in this environment.')
  }
  // acde-compat: guarded — only reached where Worker exists; see defaultManifoldRunner
  worker = new Worker(new URL('./print-shell-compiler-manifold.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.addEventListener('message', (event: MessageEvent<ManifoldWorkerResponse>) => {
    const pending = pendingRequests.get(event.data.id)
    if (!pending) return
    pendingRequests.delete(event.data.id)
    clearTimeout(pending.timeout)
    pending.resolve(event.data)
  })
  worker.addEventListener('error', (event) => {
    resetWorker(new Error(event.message || 'The Manifold worker failed.'))
  })
  worker.addEventListener('messageerror', () => {
    resetWorker(new Error('The Manifold worker returned an unreadable response.'))
  })
  return worker
}

export const runManifoldWorker: ManifoldCompileRunner = (meshes) => {
  const activeWorker = getWorker()
  const id = nextRequestId
  nextRequestId += 1
  const request: ManifoldWorkerRequest = { id, meshes, runtime: manifoldRuntime }
  const transfer = meshes.flatMap((mesh) => [
    mesh.positions.buffer as ArrayBuffer,
    mesh.indices.buffer as ArrayBuffer,
  ])

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resetWorker(new Error(`The Manifold worker exceeded ${WORKER_TIMEOUT_MS / 1000} seconds.`))
    }, WORKER_TIMEOUT_MS)
    pendingRequests.set(id, { resolve, reject, timeout })
    try {
      activeWorker.postMessage(request, transfer)
    } catch (error) {
      resetWorker(
        error instanceof Error ? error : new Error('Failed to start the Manifold worker.'),
      )
    }
  })
}

/**
 * Runs Manifold on the calling thread, for runtimes without Web Workers (acde).
 * A long compile blocks that thread for its whole duration.
 */
export const runManifoldInProcess: ManifoldCompileRunner = async (meshes) => {
  const { compileManifoldMeshData } = await import('./print-shell-compiler-manifold-core')
  return compileManifoldMeshData(meshes, manifoldRuntime)
}

/** The worker wherever one can start; otherwise the in-process runner. */
export function defaultManifoldRunner(): ManifoldCompileRunner {
  return typeof Worker === 'undefined' ? runManifoldInProcess : runManifoldWorker
}

function compiledDiagnostic(runner: ManifoldCompileRunner): { code: string; where: string } {
  if (runner === runManifoldWorker) {
    return { code: 'manifold_worker_compiler', where: ' off the main thread' }
  }
  if (runner === runManifoldInProcess) {
    return { code: 'manifold_in_process_compiler', where: ' on the main thread (no Web Workers)' }
  }
  return { code: 'manifold_compiler_candidate', where: ' through the in-process test runner' }
}

function blockedResult(
  inputMeshCount: number,
  sourceNodeIds: Iterable<string>,
  diagnostics: PrintShellCompileDiagnostic[],
): PrintShellCompileResult {
  return {
    backend: 'manifold-3d',
    status: 'blocked',
    scene: null,
    inputMeshCount,
    sourceNodeIds: Array.from(sourceNodeIds).sort(),
    diagnostics,
  }
}

export async function compileSemanticPrintShellWithManifold(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  options: SemanticManifoldCompileOptions = {},
): Promise<PrintShellCompileResult> {
  const { runner = defaultManifoldRunner(), ...semanticOptions } = options
  const prepared = prepareSemanticPrintShellSource(source, nodes, {
    ...semanticOptions,
    wallSolids: semanticOptions.wallSolids ?? true,
  })
  if (prepared.status === 'blocked') {
    return blockedResult(prepared.inputMeshCount, prepared.sourceNodeIds, prepared.diagnostics)
  }

  const input = collectPrintShellInput(prepared.scene)
  prepared.dispose()
  if (input.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    for (const geometry of input.geometries) geometry.dispose()
    return blockedResult(input.inputMeshCount, input.sourceNodeIds, input.diagnostics)
  }

  const meshes = input.geometries.map((geometry, index) =>
    geometryToManifoldMeshData(geometry, input.geometryNodeIds[index]!),
  )
  for (const geometry of input.geometries) geometry.dispose()

  let output: ManifoldCompileOutput
  try {
    output = await runner(meshes)
  } catch (error) {
    return blockedResult(input.inputMeshCount, input.sourceNodeIds, [
      ...input.diagnostics,
      {
        severity: 'error',
        code: 'manifold_worker_failed',
        message: error instanceof Error ? error.message : 'The Manifold worker failed.',
        nodeIds: Array.from(input.sourceNodeIds).sort(),
      },
    ])
  }

  const diagnostics = [...input.diagnostics, ...output.diagnostics]
  if (output.status === 'blocked') {
    return blockedResult(input.inputMeshCount, input.sourceNodeIds, diagnostics)
  }

  const geometry = geometryFromManifoldMeshData(output.positions, output.indices)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
  mesh.name = 'print-shell-manifold'
  mesh.userData = {
    printCompiler: 'manifold-3d',
    sourceNodeIds: Array.from(input.sourceNodeIds).sort(),
  }
  const scene = new THREE.Group()
  scene.name = 'compiled-print-shell'
  scene.add(mesh)
  const compiled = compiledDiagnostic(runner)
  diagnostics.push({
    severity: 'info',
    code: compiled.code,
    message: `Compiled with Manifold in ${output.durationMs.toFixed(1)} ms${compiled.where}.`,
    nodeIds: Array.from(input.sourceNodeIds).sort(),
  })
  return {
    backend: 'manifold-3d',
    status: 'compiled',
    scene,
    inputMeshCount: input.inputMeshCount,
    sourceNodeIds: Array.from(input.sourceNodeIds).sort(),
    diagnostics,
  }
}
