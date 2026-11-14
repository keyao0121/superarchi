import { expect, mock, test } from 'bun:test'
import { NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace } from 'three'

// Counts SSGI passes the real snapshot pipeline builds; the real node still does the work.
const real = await import('three/addons/tsl/display/SSGINode.js')
// Bun's module mock rewrites `real` in place, so keep the original function.
const realSsgi = real.ssgi
let ssgiPasses = 0
mock.module('three/addons/tsl/display/SSGINode.js', () => ({
  ...real,
  ssgi: (...args: Parameters<typeof realSsgi>) => {
    ssgiPasses += 1
    return realSsgi(...args)
  },
}))
const { createSnapshotPipeline } = await import('../snapshot-pipeline')

async function build(compatibilityMode: boolean) {
  ssgiPasses = 0
  const renderer = {
    backend: { compatibilityMode },
    init: async () => {},
    toneMapping: NoToneMapping,
    outputColorSpace: SRGBColorSpace,
    domElement: { width: 64, height: 32 },
  }
  const pipeline = await createSnapshotPipeline({
    renderer: renderer as never,
    scene: new Scene(),
    camera: new PerspectiveCamera(),
  })
  pipeline?.dispose()
  return pipeline !== null
}

test('in WebGPU compatibility mode the capture is built without SSGI, whose shader cannot compile', async () => {
  expect(await build(true)).toBe(true)
  expect(ssgiPasses).toBe(0)
})

test('on a core WebGPU device the capture keeps its SSGI ambient occlusion', async () => {
  expect(await build(false)).toBe(true)
  expect(ssgiPasses).toBe(1)
})
