// The acde asset mirror: every catalog asset the viewer resolves against `assetsBaseUrl`
// (`/material/…`, `/items/…`), served from `public/acde-assets/` because acde pages cannot
// reach the assets CDN. Files the app does not ship are downloaded from the CDN at build
// time, every `.ktx2` gets a `.webp` beside it and Draco GLBs are mirrored decompressed
// (acde has no Worker for KTX2Loader or DRACOLoader).
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { DRACO_EXTENSION, decompressDracoGlb } from './glb-draco'
import { ktx2ToWebp } from './ktx2-to-webp'
import { acdeAssetsDirectory, type StepResult, syncFile, writeFileIfChanged } from './prepare'

// prepare.ts imports this module to list its step, so its exports are read at call time only.
const appDirectory = () => path.resolve(acdeAssetsDirectory, '../..')
const publicDirectory = () => path.join(appDirectory(), 'public')

/** packages/viewer's ASSETS_CDN_URL: where `assetsBaseUrl` points outside acde. */
export const ASSETS_ORIGIN = 'https://editor.pascal.app'

const MIRRORED_ROOTS = ['material', 'items']
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs)$/
const SKIPPED_SOURCES = /\.(?:test|e2e)\.|\.d\.ts$/
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '__fixtures__', '__tests__'])
// A complete quoted path such as '/material/wood/oak/oak_normal_512.ktx2'; templates are not paths.
const ASSET_LITERAL = /['"`](\/(?:material|items)\/[\w./-]+\.[a-z0-9]+)['"`]/g
/** GLTF extensions that need a Web Worker to decode, which acde pages do not have. */
const WORKER_EXTENSIONS = ['KHR_texture_basisu', 'KHR_draco_mesh_compression']
const DOWNLOAD_CONCURRENCY = 8

async function filesUnder(directory: string, skip?: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) return skip?.(entry.name) ? [] : filesUnder(full, skip)
      return entry.isFile() ? [full] : []
    }),
  )
  return nested.flat()
}

/** `/material/…` and `/items/…` paths quoted whole in `source`. */
export function assetPathsIn(source: string): string[] {
  return [...source.matchAll(ASSET_LITERAL)].map((match) => match[1] as string)
}

/** Catalog paths named in packages/*\/src plus every file the app ships under them. */
export async function collectAssetPaths(): Promise<string[]> {
  const paths = new Set<string>()
  const packagesDirectory = path.resolve(appDirectory(), '../../packages')
  for (const name of await readdir(packagesDirectory)) {
    const sources = await filesUnder(path.join(packagesDirectory, name, 'src'), (entry) =>
      SKIPPED_DIRECTORIES.has(entry),
    )
    for (const file of sources) {
      if (!SOURCE_EXTENSIONS.test(file) || SKIPPED_SOURCES.test(file)) continue
      for (const found of assetPathsIn(await readFile(file, 'utf8'))) paths.add(found)
    }
  }
  for (const root of MIRRORED_ROOTS) {
    for (const file of await filesUnder(path.join(publicDirectory(), root))) {
      paths.add(`/${path.relative(publicDirectory(), file).split(path.sep).join('/')}`)
    }
  }
  return [...paths].sort()
}

/** The Worker-only extensions a GLB's JSON chunk declares. */
export function workerExtensionsInGlb(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return []
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a) return []
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    extensionsUsed?: string[]
  }
  return WORKER_EXTENSIONS.filter((name) => json.extensionsUsed?.includes(name))
}

/**
 * Where `assetPath` is mirrored, or null when it is not a plain catalog path: only
 * `/material/…` and `/items/…` with no empty, `.` or `..` segment, landing inside
 * public/acde-assets.
 */
export function mirrorTarget(assetPath: string): string | null {
  const segments = assetPath.split('/').slice(1)
  if (!assetPath.startsWith('/') || !MIRRORED_ROOTS.includes(segments[0] as string)) return null
  if (segments.length < 2 || segments.some((s) => s === '' || s === '.' || s === '..')) return null
  const target = path.resolve(acdeAssetsDirectory, `.${assetPath}`)
  const inside = path.relative(acdeAssetsDirectory, target)
  return inside.startsWith('..') || path.isAbsolute(inside) ? null : target
}

async function usesDraco(glb: string): Promise<boolean> {
  const bytes = await readFile(glb).catch(() => null)
  return bytes !== null && workerExtensionsInGlb(new Uint8Array(bytes)).includes(DRACO_EXTENSION)
}

/** Whether `file` exists and is at least as new as `than`. */
async function isNewer(file: string, than: string): Promise<boolean> {
  const [a, b] = await Promise.all([stat(file).catch(() => null), stat(than)])
  return a !== null && a.mtimeMs >= b.mtimeMs
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  )
}

async function download(assetPath: string, target: string): Promise<void> {
  const response = await fetch(`${ASSETS_ORIGIN}${assetPath}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await writeFileIfChanged(target, Buffer.from(await response.arrayBuffer()))
}

async function inPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++] as T)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Mirrors the catalog assets into public/acde-assets and converts each `.ktx2` there to
 * `.webp`. Idempotent: shipped files are copied only when they differ, downloads only when
 * missing, conversions only when the `.webp` is older than its `.ktx2`. Throws, listing
 * every failure, if any asset could not be mirrored or converted; a path that would land
 * outside the mirror fails the step before anything is written.
 */
export async function prepareAssets(
  /** Defaults to collectAssetPaths(). */
  assetPaths?: string[],
): Promise<StepResult> {
  const result: StepResult = { copied: [], unchanged: [], notes: [] }
  const failures: string[] = []
  const downloaded: string[] = []
  const toDownload: string[] = []
  const record = (target: string, written: boolean) =>
    (written ? result.copied : result.unchanged).push(path.relative(appDirectory(), target))

  const paths = assetPaths ?? (await collectAssetPaths())
  const rejected = paths.filter((assetPath) => !mirrorTarget(assetPath))
  if (rejected.length) {
    throw new Error(
      `${rejected.length} asset path(s) are not plain /material or /items paths inside public/acde-assets:\n  ${rejected.join('\n  ')}`,
    )
  }
  const targetOf = (assetPath: string) => mirrorTarget(assetPath) as string

  for (const assetPath of paths) {
    const shipped = path.join(publicDirectory(), assetPath)
    const target = targetOf(assetPath)
    if (await exists(shipped)) {
      // A Draco GLB's mirror copy is its decompressed form, written below.
      if (!(assetPath.endsWith('.glb') && (await usesDraco(shipped)))) {
        record(target, await syncFile(shipped, target))
      }
    } else if (await exists(target)) record(target, false)
    else toDownload.push(assetPath)
  }

  await inPool(toDownload, DOWNLOAD_CONCURRENCY, async (assetPath) => {
    const target = targetOf(assetPath)
    try {
      await download(assetPath, target)
      downloaded.push(assetPath)
      record(target, true)
    } catch (error) {
      failures.push(`download ${assetPath}: ${error instanceof Error ? error.message : error}`)
    }
  })

  const warnings: string[] = []
  let converted = 0
  let decompressed = 0
  for (const assetPath of paths) {
    const source = targetOf(assetPath)
    if (assetPath.endsWith('.glb')) {
      const shipped = path.join(publicDirectory(), assetPath)
      const from = (await exists(shipped)) ? shipped : source
      if (!(await exists(from))) continue
      const bytes = new Uint8Array(await readFile(from))
      const found = workerExtensionsInGlb(bytes)
      if (found.includes(DRACO_EXTENSION)) {
        if (from !== source && (await isNewer(source, from)) && !(await usesDraco(source))) {
          record(source, false)
        } else {
          try {
            record(
              source,
              await writeFileIfChanged(source, Buffer.from(await decompressDracoGlb(bytes))),
            )
            decompressed++
          } catch (error) {
            failures.push(
              `decompress ${assetPath}: ${error instanceof Error ? error.message : error}`,
            )
          }
        }
      }
      const undecodable = found.filter((name) => name !== DRACO_EXTENSION)
      if (undecodable.length) {
        warnings.push(`${assetPath} uses ${undecodable.join(', ')}: not decodable in acde`)
      }
      continue
    }
    if (!(await exists(source))) continue
    if (!assetPath.endsWith('.ktx2')) continue
    const webp = source.replace(/\.ktx2$/, '.webp')
    const [ktx2Time, webpTime] = await Promise.all([
      stat(source).then((info) => info.mtimeMs),
      stat(webp).then(
        (info) => info.mtimeMs,
        () => -1,
      ),
    ])
    if (webpTime >= ktx2Time) {
      record(webp, false)
      continue
    }
    try {
      record(webp, await writeFileIfChanged(webp, await ktx2ToWebp(await readFile(source))))
      converted++
    } catch (error) {
      failures.push(`convert ${assetPath}: ${error instanceof Error ? error.message : error}`)
    }
  }

  result.notes?.push(
    `${paths.length} catalog paths, ${downloaded.length} downloaded from ${ASSETS_ORIGIN}, ${converted} .ktx2 converted to .webp, ${decompressed} Draco .glb decompressed`,
    ...warnings.map((warning) => `warning: ${warning}`),
  )
  if (failures.length) {
    throw new Error(`${failures.length} asset(s) failed:\n  ${failures.sort().join('\n  ')}`)
  }
  return result
}
