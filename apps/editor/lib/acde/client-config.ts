import { isAcde } from '@pascal-app/core/platform'
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
