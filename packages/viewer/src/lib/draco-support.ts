import { getViewerConfig } from './viewer-config'

// three's DRACOLoader decodes in Web Workers and fetches its decoder (www.gstatic.com by
// default) as soon as a GLTF with KHR_draco_mesh_compression is parsed. Where there is no
// Worker (acde's page runtime) it would fetch the decoder and then throw
// `ReferenceError: Worker is not defined`, so such pages get a stand-in that fails the
// model with a clear error instead. Feature detection: where Worker exists nothing changes.

export function hasWebWorker(): boolean {
  return typeof Worker !== 'undefined'
}

export class DracoUnavailableError extends Error {
  constructor() {
    super(
      'Draco-compressed geometry cannot be decoded here: this runtime has no Web Worker. The model is not loaded.',
    )
    this.name = 'DracoUnavailableError'
  }
}

let warned = false

/** One console.warn per page that Draco models are skipped here; `what` names the first one. */
export function warnDracoUnavailable(what?: string) {
  if (warned) return
  warned = true
  const message = new DracoUnavailableError().message
  console.warn(`[viewer] ${message}${what ? ` (${what})` : ''}`)
}

/**
 * A DRACOLoader stand-in for GLTFLoader.setDRACOLoader: `preload` fetches nothing and every
 * decode rejects with DracoUnavailableError (one console.warn per page).
 */
export const unavailableDracoLoader = {
  preload() {
    return unavailableDracoLoader
  },
  setDecoderPath() {
    return unavailableDracoLoader
  },
  setDecoderConfig() {
    return unavailableDracoLoader
  },
  setWorkerLimit() {
    return unavailableDracoLoader
  },
  dispose() {
    return unavailableDracoLoader
  },
  decodeDracoFile(
    _buffer: ArrayBuffer,
    _callback: unknown,
    _attributeIDs?: unknown,
    _attributeTypes?: unknown,
    _vertexColorSpace?: unknown,
    onError: (error: Error) => void = () => {},
  ): Promise<void> {
    // Like DRACOLoader's `decodeGeometry(…).then(callback).catch(onError)`: the error goes to
    // onError and the returned promise settles, so callers that drop it see no rejection.
    const error = new DracoUnavailableError()
    warnDracoUnavailable()
    return Promise.resolve().then(() => {
      onError(error)
    })
  },
}

/** drei `useGLTF`'s `useDraco` argument: the configured decoder path, or false without Workers. */
export function dracoDecoderPath(): string | false {
  return hasWebWorker() ? getViewerConfig().decoders.dracoPath : false
}

/** Test hook: lets the next unavailable decode warn again. */
export function resetDracoWarning() {
  warned = false
}
