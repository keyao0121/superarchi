import { afterEach, describe, expect, test } from 'bun:test'
import { getViewerConfig, unavailableDracoLoader } from '@pascal-app/viewer'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { ItemGLTFLoader } from './model-loader'
import { configureItemModelLoader } from './renderer'

const scope = globalThis as Record<string, unknown>
let savedWorker: PropertyDescriptor | undefined

afterEach(() => {
  if (savedWorker) Object.defineProperty(scope, 'Worker', savedWorker)
  savedWorker = undefined
})

const dracoOf = (loader: ItemGLTFLoader) =>
  (loader as unknown as { dracoLoader: unknown }).dracoLoader

describe('configureItemModelLoader', () => {
  test('with Worker: a DRACOLoader on the configured decoder path, as before', () => {
    const loader = new ItemGLTFLoader()
    configureItemModelLoader(loader, null)
    const draco = dracoOf(loader)
    expect(draco).toBeInstanceOf(DRACOLoader)
    expect((draco as { decoderPaths: { wasm: string } }).decoderPaths.wasm).toBe(
      `${getViewerConfig().decoders.dracoPath}draco_decoder.wasm`,
    )
  })

  test('without Worker: the stand-in, so no DRACOLoader and no decoder request', () => {
    savedWorker = Object.getOwnPropertyDescriptor(scope, 'Worker')
    delete scope.Worker
    const loader = new ItemGLTFLoader()
    expect(() => configureItemModelLoader(loader, null)).not.toThrow()
    expect(dracoOf(loader)).toBe(unavailableDracoLoader)
  })
})
