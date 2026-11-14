import { isAcde } from '@pascal-app/core/platform'
import type { ManifoldRuntimeOptions } from '@pascal-app/editor'
import type { ViewerConfig } from '@pascal-app/viewer'

/**
 * Where catalog assets resolve under acde: the page's own origin, i.e. the
 * app's bundled `public/`. Assets that only live on the CDN are missing there
 * until the acde asset mirror (T14) exists; then this becomes
 * `http://acde.local/acde-assets`.
 */
export const ACDE_ASSETS_BASE_URL = 'http://acde.local'

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
