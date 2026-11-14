// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { getPascalTextureRef, stampPascalTextureRef } from './texture-reference'
import { configureViewer } from './viewer-config'

// The module reads the storage origin from the env, so a stamp in another file
// run earlier in the process does not decide it for this one.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test-storage.supabase.co'
const STORAGE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin

describe('Pascal texture references', () => {
  test("resolves 'material' input to library-material for storage-bucket URLs", () => {
    const texture = new THREE.Texture()
    texture.colorSpace = THREE.SRGBColorSpace
    const src = `${STORAGE_ORIGIN}/storage/v1/object/public/materials/user/mtl_1/oak_basecolor_512.ktx2`

    const ref = stampPascalTextureRef(texture, { kind: 'material', src, slot: 'map' })

    expect(ref).toEqual({
      v: 1,
      kind: 'library-material',
      src,
      map: 'basecolor',
      colorSpace: 'srgb',
    })
    expect(getPascalTextureRef(texture)).toEqual(ref)
  })

  test("resolves 'material' input to app-material for assets-CDN catalog URLs", () => {
    const cdnOrigin = new URL(process.env.NEXT_PUBLIC_ASSETS_CDN_URL || 'https://editor.pascal.app')
      .origin
    const texture = new THREE.Texture()
    const src = `${cdnOrigin}/material/concrete/prepared_drywall/prepared_drywall_normal_512.ktx2`

    const ref = stampPascalTextureRef(texture, { kind: 'material', src, slot: 'normalMap' })

    expect(ref).toEqual({ v: 1, kind: 'app-material', src, map: 'normal', colorSpace: 'linear' })
    expect(getPascalTextureRef(texture)).toEqual(ref)

    const foreign = new THREE.Texture()
    expect(
      stampPascalTextureRef(foreign, {
        kind: 'material',
        src: 'https://example.com/material/concrete/x/x_basecolor_512.ktx2',
        slot: 'map',
      }),
    ).toBeNull()
  })

  test('stamps the exact project-asset payload for Pascal storage URLs', () => {
    const texture = new THREE.Texture()
    texture.colorSpace = THREE.SRGBColorSpace

    const ref = stampPascalTextureRef(texture, {
      kind: 'project-asset',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/project-assets/project/asset.png`,
      slot: 'map',
    })

    expect(ref).toEqual({
      v: 1,
      kind: 'project-asset',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/project-assets/project/asset.png`,
      map: 'basecolor',
      colorSpace: 'srgb',
    })
    expect(getPascalTextureRef(texture)).toEqual(ref)
  })

  test('keeps local and non-Pascal URLs unstamped', () => {
    for (const src of [
      'asset://project/asset',
      'blob:https://editor.pascal.app/asset',
      'data:image/png;base64,AAAA',
      'https://example.com/storage/v1/object/public/project-assets/project/asset.png',
    ]) {
      const texture = new THREE.Texture()
      expect(stampPascalTextureRef(texture, { kind: 'project-asset', src, slot: 'map' })).toBeNull()
      expect(texture.userData.pascalTextureRef).toBeUndefined()
    }
  })

  test('includes imageIndex only for item GLB references', () => {
    const texture = new THREE.Texture()
    const ref = stampPascalTextureRef(texture, {
      kind: 'item-glb',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/items/system/chair/model.glb`,
      slot: 'normalMap',
      imageIndex: 2,
    })

    expect(ref).toEqual({
      v: 1,
      kind: 'item-glb',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/items/system/chair/model.glb`,
      imageIndex: 2,
      map: 'normal',
      colorSpace: 'linear',
    })
  })
})

describe('app materials under an assets base with a path', () => {
  const mirror = 'http://acde.local/acde-assets'
  let savedAppId: string | undefined

  const stampKind = (src: string) =>
    stampPascalTextureRef(new THREE.Texture(), { kind: 'material', src, slot: 'normalMap' })
      ?.kind ?? null

  beforeEach(() => {
    savedAppId = process.env.ACDE_APP_ID
  })

  afterEach(() => {
    if (savedAppId === undefined) delete process.env.ACDE_APP_ID
    else process.env.ACDE_APP_ID = savedAppId
    configureViewer({})
  })

  test('outside acde: only the origin counts, as before', () => {
    delete process.env.ACDE_APP_ID
    configureViewer({ assetsBaseUrl: 'https://cdn.example/assets' })
    expect(stampKind('https://cdn.example/material/oak_normal.ktx2')).toBe('app-material')
    expect(stampKind('https://cdn.example/assets/material/oak_normal.ktx2')).toBeNull()
    expect(stampKind('https://other.example/material/oak_normal.ktx2')).toBeNull()
  })

  test('in acde: catalog maps under the mirror path, and nothing else on that origin', () => {
    // Without a window, isAcde() reads the backend's ACDE_APP_ID.
    process.env.ACDE_APP_ID = 'pascal-editor'
    configureViewer({ assetsBaseUrl: mirror })
    const texture = new THREE.Texture()
    const src = `${mirror}/material/siding/lap_normal_512.ktx2`
    const ref = stampPascalTextureRef(texture, { kind: 'material', src, slot: 'normalMap' })
    expect(ref).toEqual({ v: 1, kind: 'app-material', src, map: 'normal', colorSpace: 'linear' })
    expect(getPascalTextureRef(texture)).toEqual(ref)
    expect(stampKind('http://acde.local/material/siding/lap_normal_512.ktx2')).toBeNull()
    expect(stampKind(`${mirror}/items/sofa/model.glb`)).toBeNull()
  })

  test('in acde: a trailing slash on the base changes nothing', () => {
    process.env.ACDE_APP_ID = 'pascal-editor'
    configureViewer({ assetsBaseUrl: `${mirror}/` })
    expect(stampKind(`${mirror}/material/siding/lap_normal_512.ktx2`)).toBe('app-material')
  })
})
