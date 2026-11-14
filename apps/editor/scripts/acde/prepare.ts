// Prepares what an acde build needs in `public/acde-assets/` before acde runs
// `next build` (acde calls the framework directly, so no package-script hook
// runs). Each step is idempotent and the script exits non-zero on any failure.
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENE_HOST_BUNDLE } from '../../lib/agent/host-bundle'
import { bundleSceneHost } from './agent-host'
import { prepareAssets } from './assets'
import {
  buildIconSubset,
  EXEMPT_ICONS,
  ICON_SUBSET_PATH,
  iconSetsFrom,
  iconSourceDirectories,
  installedIconPrefixes,
  scanIconNamesIn,
} from './icons'

const scriptPath = fileURLToPath(import.meta.url)
const appDirectory = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(appDirectory, '../..')
export const acdeAssetsDirectory = path.join(appDirectory, 'public/acde-assets')

export type StepResult = { copied: string[]; unchanged: string[]; notes?: string[] }

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

/** Writes `bytes` to `target` unless the target already has them. */
export async function writeFileIfChanged(target: string, bytes: Buffer): Promise<boolean> {
  const current = await readFile(target).catch(() => null)
  if (current?.equals(bytes)) return false
  await mkdir(path.dirname(target), { recursive: true })
  const partial = `${target}.partial`
  await writeFile(partial, bytes)
  await rename(partial, target)
  return true
}

/**
 * manifold-3d for the print export. acde cannot import ES modules from a CDN, so the
 * in-process Manifold runner loads this copy (`ACDE_MANIFOLD_RUNTIME` in lib/acde/client-config.ts).
 * Resolved from packages/editor, which owns the dependency.
 */
export async function stageManifold(): Promise<StepResult> {
  const fromEditor = createRequire(path.join(repositoryRoot, 'packages/editor/package.json'))
  const glue = fromEditor.resolve('manifold-3d/manifold.js')
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

/**
 * The Iconify icons named in source, from the `@iconify-json/*` devDependencies: acde
 * cannot reach api.iconify.design (`configureAcdeIcons` in lib/acde/client-config.ts).
 */
export async function stageIcons(): Promise<StepResult> {
  const { names, unresolved } = await scanIconNamesIn(
    await iconSourceDirectories(repositoryRoot),
    await installedIconPrefixes(repositoryRoot),
    repositoryRoot,
  )
  const subsets = await buildIconSubset(names, iconSetsFrom(appDirectory))
  const target = path.join(acdeAssetsDirectory, ICON_SUBSET_PATH)
  const relative = path.relative(appDirectory, target)
  const written = await writeFileIfChanged(target, Buffer.from(`${JSON.stringify(subsets)}\n`))
  const exempt = [...names].filter((name) => name in EXEMPT_ICONS).sort()
  return {
    copied: written ? [relative] : [],
    unchanged: written ? [] : [relative],
    notes: [
      `${names.size - exempt.length} icons from ${subsets.map((set) => set.prefix).join(', ')}`,
      ...exempt.map((name) => `exempt ${name}: ${EXEMPT_ICONS[name]}`),
      ...(unresolved.length
        ? [
            `${unresolved.length} icon positions are not literals, so only names written elsewhere as literals of an installed set are covered:`,
            ...unresolved.map((location) => `  ${location}`),
          ]
        : []),
    ],
  }
}

/** The MCP server the AI team's backend runs in-process, as its own bundle. */
export async function stageAgentHost(): Promise<StepResult> {
  const written = await bundleSceneHost(path.join(appDirectory, SCENE_HOST_BUNDLE))
  return {
    copied: written ? [SCENE_HOST_BUNDLE] : [],
    unchanged: written ? [] : [SCENE_HOST_BUNDLE],
  }
}

const steps: { name: string; run: () => Promise<StepResult> }[] = [
  { name: 'manifold', run: stageManifold },
  { name: 'assets', run: prepareAssets },
  { name: 'icons', run: stageIcons },
  { name: 'agent-host', run: stageAgentHost },
]

const isEntryPoint = process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath

if (isEntryPoint) {
  try {
    for (const step of steps) {
      const { copied, unchanged, notes = [] } = await step.run()
      console.log(
        `acde:prepare ${step.name}: ${copied.length} copied, ${unchanged.length} unchanged`,
      )
      for (const file of copied) console.log(`  + ${file}`)
      for (const note of notes) console.log(`  ${note}`)
    }
  } catch (error) {
    console.error(`acde:prepare failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
