import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { configureKtx2Support, ensureKtx2Support, ktx2Loader } from './ktx2-loader'
import { getViewerConfig } from './viewer-config'

const scope = globalThis as Record<string, unknown>
const internals = ktx2Loader as unknown as {
  detectSupport: (renderer: unknown) => unknown
  transcoderPath: string
}

describe('ensureKtx2Support / configureKtx2Support', () => {
  let savedWorker: PropertyDescriptor | undefined
  let detect: ReturnType<typeof spyOn>
  let warn: ReturnType<typeof spyOn>
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    detect = spyOn(internals, 'detectSupport').mockImplementation(() => ktx2Loader)
    warn = spyOn(console, 'warn').mockImplementation(() => {})
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    detect.mockRestore()
    warn.mockRestore()
    fetchSpy.mockRestore()
    if (savedWorker) Object.defineProperty(scope, 'Worker', savedWorker)
    savedWorker = undefined
  })

  test('without Worker: no KTX2 loader for GLTFs, no transcoder request, one warning', () => {
    savedWorker = Object.getOwnPropertyDescriptor(scope, 'Worker')
    delete scope.Worker
    const renderer = {}
    const setKTX2Loader = spyOn({ setKTX2Loader: () => {} }, 'setKTX2Loader')
    expect(ensureKtx2Support(renderer)).toBe(false)
    expect(configureKtx2Support({ setKTX2Loader }, renderer)).toBe(false)
    expect(detect).not.toHaveBeenCalled()
    expect(setKTX2Loader).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toStartWith(
      '[viewer] KTX2 textures cannot be transcoded here: this runtime has no Web Worker.',
    )
  })

  test('with Worker: detects support and hands GLTFs the shared loader, as before', () => {
    const renderer = {}
    const target = { setKTX2Loader: (_loader: unknown) => {} }
    const setKTX2Loader = spyOn(target, 'setKTX2Loader')
    expect(configureKtx2Support(target, renderer)).toBe(true)
    expect(detect).toHaveBeenCalledWith(renderer)
    expect(setKTX2Loader).toHaveBeenCalledWith(ktx2Loader)
    expect(internals.transcoderPath).toBe(getViewerConfig().decoders.basisPath)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
