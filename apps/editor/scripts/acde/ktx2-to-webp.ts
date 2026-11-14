// Converts KTX2 (Basis Universal) textures to WebP for the acde asset mirror: acde pages
// have no Web Worker, which three's KTX2Loader needs. Runs at build time only, on the
// main thread, with the transcoder three ships and sharp as the encoder.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import sharp from 'sharp'

const require = createRequire(import.meta.url)

/** basis_transcoder's TranscoderTextureFormat.cTFRGBA32 (three's KTX2Loader: `RGBA32: 13`). */
const RGBA32 = 13
/** The KTX 2.0 file identifier: «KTX 20»\r\n\x1A\n. */
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

type KTX2File = {
  isValid(): boolean
  isHDR(): boolean
  getWidth(): number
  getHeight(): number
  getHasAlpha(): boolean
  startTranscoding(): boolean
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    getAlphaForOpaqueFormats: number,
    channel0: number,
    channel1: number,
  ): number
  close(): void
  delete(): void
}

type BasisModule = {
  initializeBasis(): void
  KTX2File: new (bytes: Uint8Array) => KTX2File
}

export type DecodedKtx2 = { width: number; height: number; hasAlpha: boolean; rgba: Uint8Array }

let transcoder: Promise<BasisModule> | undefined

/** three's basis_transcoder.{js,wasm}, loaded once. The .js is a classic script, not a module. */
export function loadBasisTranscoder(): Promise<BasisModule> {
  transcoder ??= (async () => {
    const scriptPath = require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js')
    const [script, wasmBinary] = await Promise.all([
      readFile(scriptPath, 'utf8'),
      readFile(scriptPath.replace(/\.js$/, '.wasm')),
    ])
    const factory = new Function('require', '__filename', '__dirname', `${script}\nreturn BASIS`)(
      require,
      scriptPath,
      path.dirname(scriptPath),
    ) as (module: object) => Promise<BasisModule>
    const basis = await factory({ wasmBinary })
    basis.initializeBasis()
    return basis
  })()
  return transcoder
}

/** pixelWidth/pixelHeight from a KTX2 header (little-endian u32s at bytes 20 and 24). */
export function readKtx2Size(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(20, true), height: view.getUint32(24, true) }
}

/** The base level of a 2D KTX2 texture as RGBA8 rows, top row first, as stored. */
export async function decodeKtx2(bytes: Uint8Array): Promise<DecodedKtx2> {
  if (!KTX2_IDENTIFIER.every((byte, index) => bytes[index] === byte)) {
    throw new Error('not a valid KTX2 file')
  }
  const basis = await loadBasisTranscoder()
  const file = new basis.KTX2File(bytes)
  try {
    if (!file.isValid()) throw new Error('not a valid KTX2 file')
    if (file.isHDR()) throw new Error('HDR KTX2 has no 8-bit RGBA form')
    if (!file.startTranscoding()) throw new Error('the transcoder could not start')
    const rgba = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32))
    if (!file.transcodeImage(rgba, 0, 0, 0, RGBA32, 0, -1, -1)) {
      throw new Error('transcoding the base level failed')
    }
    return { width: file.getWidth(), height: file.getHeight(), hasAlpha: file.getHasAlpha(), rgba }
  } finally {
    file.close()
    file.delete()
  }
}

/**
 * The KTX2 texture's base level as WebP. Pixels keep the KTX2's row order and colour values
 * (no colour profile), so the page uses it as KTX2Loader would (flipY false, its own colour
 * space). Mipmaps are left to the renderer.
 */
export async function ktx2ToWebp(bytes: Uint8Array): Promise<Buffer> {
  const { width, height, hasAlpha, rgba } = await decodeKtx2(bytes)
  const image = sharp(rgba, { raw: { width, height, channels: 4 } })
  return (hasAlpha ? image : image.removeAlpha()).webp({ quality: 90 }).toBuffer()
}
