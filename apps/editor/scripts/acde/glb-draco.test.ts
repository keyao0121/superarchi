import { afterAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BufferGeometry, Mesh, Object3D } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { workerExtensionsInGlb } from './assets'
import { DRACO_EXTENSION, decompressDracoGlb, parseGlb, writeGlb } from './glb-draco'

const shippedGlb = (item: string) =>
  readFile(path.resolve(import.meta.dir, '../../public/items', item, 'model.glb')).then(
    (bytes) => new Uint8Array(bytes),
  )

// The reference: three's own DRACOLoader (Bun has Workers) on the decoder files three ships.
// three's FileLoader reports progress with ProgressEvent, which Bun lacks.
const scope = globalThis as Record<string, unknown>
const hadProgressEvent = 'ProgressEvent' in scope
if (!hadProgressEvent) scope.ProgressEvent = class extends Event {}
const dracoLoader = new DRACOLoader().setDecoderPath(
  `file://${path.dirname(Bun.resolveSync('three/examples/jsm/libs/draco/gltf/draco_decoder.wasm', import.meta.dir))}/`,
)
afterAll(() => {
  dracoLoader.dispose()
  if (!hadProgressEvent) delete scope.ProgressEvent
})

/** Every primitive's geometry, mesh by mesh, as three's GLTFLoader reads the GLB. */
async function threeGeometries(glb: Uint8Array, draco: boolean): Promise<BufferGeometry[]> {
  const loader = new GLTFLoader()
  if (draco) loader.setDRACOLoader(dracoLoader)
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer
  const gltf = await loader.parseAsync(buffer, '')
  const geometries: BufferGeometry[] = []
  for (let index = 0; index < (parseGlb(glb).json.meshes?.length ?? 0); index++) {
    const node = (await gltf.parser.getDependency('mesh', index)) as Object3D
    const meshes = (node as Mesh).isMesh ? [node as Mesh] : (node.children as Mesh[])
    geometries.push(...meshes.map((mesh) => mesh.geometry))
  }
  return geometries
}

/** Attribute and index values, so two geometries compare as plain data. */
function values(geometry: BufferGeometry) {
  const attributes = Object.fromEntries(
    Object.entries(geometry.attributes).map(([name, attribute]) => {
      const items: number[] = []
      for (let i = 0; i < attribute.count; i++) {
        for (let c = 0; c < attribute.itemSize; c++) items.push(attribute.getComponent(i, c))
      }
      return [name, { itemSize: attribute.itemSize, items }]
    }),
  )
  return { attributes, index: Array.from(geometry.getIndex()?.array ?? []) }
}

describe('decompressDracoGlb', () => {
  // thermostat: its encoder shares one index accessor between primitives with different Draco data.
  for (const item of ['sofa', 'single-bed', 'thermostat']) {
    test(`${item}: no Draco left, and the same geometry three's DRACOLoader decodes`, async () => {
      const original = await shippedGlb(item)
      const before = parseGlb(original).json
      expect(workerExtensionsInGlb(original)).toContain(DRACO_EXTENSION)

      const output = await decompressDracoGlb(original)

      expect(workerExtensionsInGlb(output)).toEqual([])
      expect(new TextDecoder().decode(output)).not.toContain(DRACO_EXTENSION)
      const after = parseGlb(output).json
      expect(after.extensionsRequired).toBeUndefined()
      expect(after.extensionsUsed ?? []).toEqual(
        (before.extensionsUsed ?? []).filter((name) => name !== DRACO_EXTENSION),
      )
      expect(after.meshes?.map((mesh) => mesh.primitives.length)).toEqual(
        before.meshes?.map((mesh) => mesh.primitives.length),
      )

      const [reference, decompressed] = await Promise.all([
        threeGeometries(original, true),
        threeGeometries(output, false),
      ])
      expect(decompressed.length).toBe(reference.length)
      reference.forEach((geometry, index) => {
        const expected = values(geometry)
        expect(expected.attributes.position?.items.length).toBeGreaterThan(0)
        expect(values(decompressed[index] as BufferGeometry)).toEqual(expected)
      })
    })
  }

  test('a GLB without Draco comes back as it was', async () => {
    const plain = writeGlb({ asset: { version: '2.0' } } as never, new Uint8Array(0))
    expect(await decompressDracoGlb(plain)).toBe(plain)
  })

  test('rejects bytes that are not a GLB', async () => {
    await expect(decompressDracoGlb(new Uint8Array(64))).rejects.toThrow('not a GLB')
  })
})
