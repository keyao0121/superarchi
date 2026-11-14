// Prepares what an acde build needs in `public/acde-assets/` before acde runs
// `next build` (acde calls the framework directly, so no package-script hook
// runs). Each step is idempotent and the script exits non-zero on any failure.
import { copyFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import path from 'node:path'

const appDirectory = path.resolve(import.meta.dir, '../..')
const repositoryRoot = path.resolve(appDirectory, '../..')
export const acdeAssetsDirectory = path.join(appDirectory, 'public/acde-assets')

export type StepResult = { copied: string[]; unchanged: string[] }

/** Copies `source` to `target` unless the target already has the same bytes. */
export async function syncFile(source: string, target: string): Promise<boolean> {
  const [sourceBytes, targetBytes] = await Promise.all([
    readFile(source),
    readFile(target).catch(() => null),
  ])
  if (targetBytes?.equals(sourceBytes)) return false
  await mkdir(path.dirname(target), { recursive: true })
  const partial = `${target}.partial`
  await copyFile(source, partial)
  await rename(partial, target)
  return true
}

/**
 * manifold-3d for the print export. acde cannot import ES modules from a CDN, so the
 * in-process Manifold runner loads this copy (`ACDE_MANIFOLD_RUNTIME` in lib/acde/client-config.ts).
 * Resolved from packages/editor, which owns the dependency.
 */
export async function stageManifold(): Promise<StepResult> {
  const glue = Bun.resolveSync(
    'manifold-3d/manifold.js',
    path.join(repositoryRoot, 'packages/editor'),
  )
  const wasm = path.join(path.dirname(glue), 'manifold.wasm')
  await stat(wasm)
  const target = path.join(acdeAssetsDirectory, 'vendor/manifold')
  const result: StepResult = { copied: [], unchanged: [] }
  for (const source of [glue, wasm]) {
    const destination = path.join(target, path.basename(source))
    const relative = path.relative(appDirectory, destination)
    if (await syncFile(source, destination)) result.copied.push(relative)
    else result.unchanged.push(relative)
  }
  return result
}

const steps: { name: string; run: () => Promise<StepResult> }[] = [
  { name: 'manifold', run: stageManifold },
]

if (import.meta.main) {
  try {
    for (const step of steps) {
      const { copied, unchanged } = await step.run()
      console.log(
        `acde:prepare ${step.name}: ${copied.length} copied, ${unchanged.length} unchanged`,
      )
      for (const file of copied) console.log(`  + ${file}`)
    }
  } catch (error) {
    console.error(`acde:prepare failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
