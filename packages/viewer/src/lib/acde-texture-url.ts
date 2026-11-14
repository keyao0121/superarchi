import { isAcde } from '@pascal-app/core/platform'
import { isKtx2Url } from './ktx2-loader'

/** Where an acde page loads a texture from instead of `url`, and how it must be oriented. */
export type AcdeTextureSource = { url: string; flipY: boolean }

/**
 * acde pages cannot transcode KTX2 (KTX2Loader needs Web Workers), so the acde build
 * converts every mirrored `.ktx2` to a `.webp` beside it (apps/editor/scripts/acde). This
 * keys on acde rather than on Worker support because those `.webp` files exist only in
 * the acde asset mirror. KTX2Loader's compressed textures are never flipped, so the image
 * replacing one must not be either. Null: load `url` as is.
 */
export function acdeTextureSource(url: string, acde = isAcde()): AcdeTextureSource | null {
  if (!acde || !isKtx2Url(url)) return null
  return { url: url.replace(/\.ktx2$/i, '.webp'), flipY: false }
}
