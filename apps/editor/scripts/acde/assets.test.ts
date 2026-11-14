import { describe, expect, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  assetPathsIn,
  collectAssetPaths,
  mirrorTarget,
  prepareAssets,
  workerExtensionsInGlb,
} from './assets'
import { acdeAssetsDirectory } from './prepare'

function glb(json: object): Uint8Array {
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const chunk = new TextEncoder().encode(text)
  const bytes = new Uint8Array(20 + chunk.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.length, true)
  view.setUint32(12, chunk.length, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  bytes.set(chunk, 20)
  return bytes
}

describe('assetPathsIn', () => {
  test('finds whole quoted catalog paths and skips templates and other roots', () => {
    const source = `
      albedoMap: '/material/wood/oak/oak_basecolor_512.ktx2',
      src: "/items/sofa/model.glb",
      thumb: \`/items/sofa/thumbnail.webp\`,
      dynamic: \`/items/\${id}/model.glb\`,
      pattern: '/material/{category}/{slug}.ktx2',
      prefix: '/material/',
      icon: '/icons/door.webp',
    `
    expect(assetPathsIn(source)).toEqual([
      '/material/wood/oak/oak_basecolor_512.ktx2',
      '/items/sofa/model.glb',
      '/items/sofa/thumbnail.webp',
    ])
  })
})

describe('collectAssetPaths', () => {
  test('includes the material library and the shipped items, without duplicates', async () => {
    const paths = await collectAssetPaths()
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('/material/siding/lap_normal_512.ktx2')
    expect(paths).toContain('/items/sofa/model.glb')
    expect(paths.every((found) => /^\/(?:material|items)\//.test(found))).toBe(true)
  })
})

describe('workerExtensionsInGlb', () => {
  test('names the Worker-only extensions a GLB uses', () => {
    const bytes = glb({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_materials_emissive_strength', 'KHR_draco_mesh_compression'],
    })
    expect(workerExtensionsInGlb(bytes)).toEqual(['KHR_draco_mesh_compression'])
    expect(
      workerExtensionsInGlb(
        glb({ extensionsUsed: ['KHR_texture_basisu', 'KHR_draco_mesh_compression'] }),
      ),
    ).toEqual(['KHR_texture_basisu', 'KHR_draco_mesh_compression'])
  })

  test('nothing for plain GLBs or other bytes', () => {
    expect(workerExtensionsInGlb(glb({ asset: { version: '2.0' } }))).toEqual([])
    expect(workerExtensionsInGlb(new Uint8Array(64))).toEqual([])
  })
})

describe('paths outside the mirror', () => {
  const escaping = [
    '/material/../../escaped.webp',
    '/items/../../../escaped.glb',
    '/material/./oak.ktx2',
    '/material//oak.ktx2',
    '/icons/door.webp',
    '/material',
    'material/oak.ktx2',
  ]

  test('mirrorTarget keeps catalog paths inside public/acde-assets and rejects the rest', () => {
    expect(mirrorTarget('/material/wood/oak/oak_normal_512.ktx2')).toBe(
      path.join(acdeAssetsDirectory, 'material/wood/oak/oak_normal_512.ktx2'),
    )
    for (const assetPath of escaping) expect(mirrorTarget(assetPath)).toBeNull()
  })

  test('the scanner can pick up a .. path, so the step must refuse it', () => {
    expect(assetPathsIn("const map = '/material/../../escaped.webp'")).toEqual([
      '/material/../../escaped.webp',
    ])
  })

  test('prepareAssets fails before writing or fetching anything', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    try {
      await expect(
        prepareAssets(['/material/siding/lap_normal_512.ktx2', '/material/../../escaped.webp']),
      ).rejects.toThrow('/material/../../escaped.webp')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(existsSync(path.resolve(acdeAssetsDirectory, '../escaped.webp'))).toBe(false)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
