// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { MaterialPresetPayload } from '@pascal-app/core'
import { Texture, TextureLoader } from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import { acdeTextureSource } from './acde-texture-url'
import { clearMaterialCache, createMaterialFromPreset } from './materials'
import { configureViewer } from './viewer-config'

const ASSETS = 'http://acde.local/acde-assets'

describe('acdeTextureSource', () => {
  test('outside acde: null, so every texture loads as before', () => {
    expect(acdeTextureSource(`${ASSETS}/material/wood/oak/oak_normal_512.ktx2`, false)).toBeNull()
  })

  test('in acde: a .ktx2 map loads as the .webp beside it, unflipped like KTX2', () => {
    expect(acdeTextureSource(`${ASSETS}/material/wood/oak/oak_normal_512.ktx2`, true)).toEqual({
      url: `${ASSETS}/material/wood/oak/oak_normal_512.webp`,
      flipY: false,
    })
    expect(acdeTextureSource('/material/a/B.KTX2', true)).toEqual({
      url: '/material/a/B.webp',
      flipY: false,
    })
  })

  test('in acde: other images are not touched', () => {
    expect(acdeTextureSource(`${ASSETS}/material/wood/oak/oak_thumb.webp`, true)).toBeNull()
    expect(acdeTextureSource('https://example.com/tile.png', true)).toBeNull()
  })
})

describe('material textures in the viewer', () => {
  // A preset path unique to each test, so the module's texture cache never answers instead.
  let run = 0
  let maps: { albedoMap: string }
  let loadAsync: ReturnType<typeof spyOn>
  let savedAppId: string | undefined

  const preset = (): MaterialPresetPayload =>
    ({
      maps,
      mapProperties: {
        color: '#ffffff',
        roughness: 0.5,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    }) as unknown as MaterialPresetPayload

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    run++
    maps = { albedoMap: `/material/test/t${run}/t${run}_basecolor_512.ktx2` }
    configureViewer({ assetsBaseUrl: ASSETS })
    loadAsync = spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(
      async () => new Texture(),
    )
    savedAppId = process.env.ACDE_APP_ID
  })

  afterEach(() => {
    loadAsync.mockRestore()
    if (savedAppId === undefined) delete process.env.ACDE_APP_ID
    else process.env.ACDE_APP_ID = savedAppId
    configureViewer({})
    clearMaterialCache()
  })

  test('in acde: the .ktx2 map is requested as .webp from the mirror and stays unflipped', async () => {
    // Without a window, isAcde() reads the backend's ACDE_APP_ID.
    process.env.ACDE_APP_ID = 'pascal-editor'
    const material = createMaterialFromPreset(preset()) as MeshStandardNodeMaterial
    await settle()
    expect(loadAsync).toHaveBeenCalledTimes(1)
    expect(loadAsync.mock.calls[0]?.[0]).toBe(
      `${ASSETS}/material/test/t${run}/t${run}_basecolor_512.webp`,
    )
    expect(material.map).toBeInstanceOf(Texture)
    // The preset says flipY: true; a KTX2 stand-in keeps KTX2's orientation.
    expect(material.map?.flipY).toBe(false)
  })

  test('outside acde: the .ktx2 map goes to the KTX2 loader, never fetched as an image', async () => {
    delete process.env.ACDE_APP_ID
    createMaterialFromPreset(preset())
    await settle()
    expect(loadAsync).not.toHaveBeenCalled()
  })

  test('outside acde: an image map is loaded as is, with the preset flipY', async () => {
    delete process.env.ACDE_APP_ID
    maps = { albedoMap: `/material/test/t${run}/t${run}_basecolor.png` }
    const material = createMaterialFromPreset(preset()) as MeshStandardNodeMaterial
    await settle()
    expect(loadAsync.mock.calls[0]?.[0]).toBe(
      `${ASSETS}/material/test/t${run}/t${run}_basecolor.png`,
    )
    expect(material.map?.flipY).toBe(true)
  })
})
