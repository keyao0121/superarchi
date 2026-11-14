import type { IconifyJSON } from '@iconify/react'
import { isAcde } from '@pascal-app/core/platform'
import type { ManifoldRuntimeOptions } from '@pascal-app/editor'
import type { ViewerConfig } from '@pascal-app/viewer'

/**
 * Where catalog assets resolve under acde: the asset mirror that
 * `scripts/acde/prepare.ts` (assets step) writes to `public/acde-assets/`.
 */
export const ACDE_ASSETS_BASE_URL = 'http://acde.local/acde-assets'

/** Overrides merged into `configureViewer` when the page runs in acde, or none. */
export function acdeViewerConfig(acde = isAcde()): Partial<ViewerConfig> {
  return acde ? { assetsBaseUrl: ACDE_ASSETS_BASE_URL } : {}
}

/** acdert has no WebXR, so the plugin is neither registered nor started there. */
export function shouldLoadWebXR(acde = isAcde()): boolean {
  return !acde
}

/** Where `scripts/acde/prepare.ts` puts manifold-3d: acde cannot import ES modules from a CDN. */
export const ACDE_MANIFOLD_RUNTIME: ManifoldRuntimeOptions = {
  moduleUrl: '/acde-assets/vendor/manifold/manifold.js',
  wasmUrl: '/acde-assets/vendor/manifold/manifold.wasm',
}

/** Points the print export's Manifold loader at the bundled copy when the page runs in acde. */
export function configureAcdeManifold(
  configure: (options: ManifoldRuntimeOptions | undefined) => void,
  acde = isAcde(),
): void {
  if (acde) configure(ACDE_MANIFOLD_RUNTIME)
}

/** Where `scripts/acde/prepare.ts` puts the Iconify icons the app names (`ICON_SUBSET_PATH`). */
export const ACDE_ICON_SUBSET_URL = '/acde-assets/iconify/icons.json'

type IconifyRegistry = {
  addCollection: (set: IconifyJSON) => boolean
  setFetch: (fetch: typeof globalThis.fetch) => void
}

async function fetchIconSubset(): Promise<IconifyJSON[]> {
  const response = await fetch(ACDE_ICON_SUBSET_URL)
  if (!response.ok) throw new Error(`${ACDE_ICON_SUBSET_URL}: HTTP ${response.status}`)
  return (await response.json()) as IconifyJSON[]
}

/**
 * acde cannot reach api.iconify.design, so under acde Iconify's API requests are answered
 * from the bundled subset instead: the first request loads it and adds every set with
 * `addCollection`, and a prefix outside it answers 404, which Iconify records as missing.
 * Loading on request rather than here keeps server rendering, where no icon loads, off the
 * network, and leaves no window in which an icon could ask the real API.
 */
export function configureAcdeIcons(
  iconify: IconifyRegistry,
  acde = isAcde(),
  loadSubset: () => Promise<IconifyJSON[]> = fetchIconSubset,
): void {
  if (!acde) return
  let loading: Promise<IconifyJSON[]> | undefined
  const subset = () => {
    loading ??= loadSubset().then(
      (sets) => {
        for (const set of sets) iconify.addCollection(set)
        return sets
      },
      (error: unknown) => {
        loading = undefined
        throw error
      },
    )
    return loading
  }
  // Iconify calls fetch with the request URL as a string and reads only `status` and `json()`.
  iconify.setFetch((async (url: string) => {
    const prefix = new URL(url).pathname.match(/\/([^/]+)\.json$/)?.[1]
    const set = (await subset()).find((candidate) => candidate.prefix === prefix)
    return set ? { status: 200, json: async () => set } : { status: 404, json: async () => 404 }
  }) as typeof globalThis.fetch)
}
