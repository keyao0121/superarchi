// 2D canvases for pages without OffscreenCanvas (acde's page runtime has none). Feature
// detection, not isAcde(): where OffscreenCanvas exists it is used exactly as before.

export type Canvas2D = OffscreenCanvas | HTMLCanvasElement
export type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** An OffscreenCanvas where there is one, otherwise a detached `<canvas>` of the same size. */
export function createCanvas2D(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height) // acde-compat: guarded
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** The canvas's 2D context; null when the canvas cannot provide one. */
export function getContext2D(canvas: Canvas2D): Canvas2DContext | null {
  // Both kinds have getContext('2d'); TypeScript cannot call it through the union.
  return (canvas as { getContext(id: '2d'): Canvas2DContext | null }).getContext('2d')
}

/** `convertToBlob` on an OffscreenCanvas, `toBlob` on a `<canvas>`; rejects when encoding fails. */
export function canvasToBlob(canvas: Canvas2D, options?: ImageEncodeOptions): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob(options)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The canvas could not be encoded'))),
      options?.type,
      options?.quality,
    ),
  )
}

export type DecodedImage = ImageBitmap | HTMLImageElement

/** `createImageBitmap` where it exists (not in acde), otherwise a decoded `<img>`; both draw onto a 2D canvas. */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== 'undefined') return createImageBitmap(blob) // acde-compat: guarded
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    // A decoded image keeps its pixels once its URL is revoked.
    URL.revokeObjectURL(url)
  }
}

/** Frees an ImageBitmap's memory now; an `<img>` is left to the garbage collector. */
export function releaseImage(image: DecodedImage) {
  if ('close' in image) image.close()
}
