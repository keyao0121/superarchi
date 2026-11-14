import { describe, expect, test } from 'bun:test'
import type { IconifyJSON } from '@iconify/react'
import {
  ACDE_ASSETS_BASE_URL,
  ACDE_ICON_SUBSET_URL,
  ACDE_MANIFOLD_RUNTIME,
  acdeViewerConfig,
  configureAcdeIcons,
  configureAcdeManifold,
  shouldLoadWebXR,
} from './client-config'

test('outside acde the viewer config is left as the host sets it', () => {
  expect(acdeViewerConfig(false)).toEqual({})
  // bun test is a server-like scope without ACDE_APP_ID, so the default is "not acde"
  expect(acdeViewerConfig()).toEqual({})
})

test('under acde catalog assets resolve against the asset mirror in public/acde-assets', () => {
  expect(acdeViewerConfig(true)).toEqual({ assetsBaseUrl: 'http://acde.local/acde-assets' })
  // scripts/acde/prepare.ts's acdeAssetsDirectory: the URL path names that folder of public/
  expect(new URL(ACDE_ASSETS_BASE_URL).pathname).toBe('/acde-assets')
})

test('WebXR loads everywhere but acde', () => {
  expect(shouldLoadWebXR(false)).toBe(true)
  expect(shouldLoadWebXR(true)).toBe(false)
  expect(shouldLoadWebXR()).toBe(true)
})

test('the Manifold runtime is redirected to the bundled copy only under acde', () => {
  const calls: unknown[] = []
  const configure = (options: unknown) => calls.push(options)

  configureAcdeManifold(configure, false)
  configureAcdeManifold(configure)
  expect(calls).toEqual([])

  configureAcdeManifold(configure, true)
  expect(calls).toEqual([ACDE_MANIFOLD_RUNTIME])
  expect(ACDE_MANIFOLD_RUNTIME.moduleUrl).toBe('/acde-assets/vendor/manifold/manifold.js')
  expect(ACDE_MANIFOLD_RUNTIME.wasmUrl).toBe('/acde-assets/vendor/manifold/manifold.wasm')
})

describe('configureAcdeIcons', () => {
  const LUCIDE: IconifyJSON = { prefix: 'lucide', icons: { box: { body: '<path/>' } } }
  const API = 'https://api.iconify.design'

  function iconifyDouble() {
    const added: IconifyJSON[] = []
    let fetcher: typeof fetch | undefined
    return {
      added,
      fetcher: () => fetcher,
      registry: {
        addCollection: (set: IconifyJSON) => added.push(set) > 0,
        setFetch: (f: typeof fetch) => {
          fetcher = f
        },
      },
    }
  }

  test('outside acde Iconify keeps its own fetch and API', () => {
    const iconify = iconifyDouble()
    let loads = 0
    configureAcdeIcons(iconify.registry, false, async () => {
      loads++
      return [LUCIDE]
    })
    configureAcdeIcons(iconify.registry)
    expect(iconify.fetcher()).toBeUndefined()
    expect(iconify.added).toEqual([])
    expect(loads).toBe(0)
  })

  test('under acde API requests are answered from the bundled subset, never the network', async () => {
    const iconify = iconifyDouble()
    const original = globalThis.fetch
    const network: string[] = []
    globalThis.fetch = (async (input: string) => {
      network.push(String(input))
      throw new Error('network')
    }) as unknown as typeof fetch
    let loads = 0
    try {
      configureAcdeIcons(iconify.registry, true, async () => {
        loads++
        return [LUCIDE]
      })
      // nothing loads until Iconify asks
      expect(loads).toBe(0)
      const fetcher = iconify.fetcher()!
      const hit = await fetcher(`${API}/lucide.json?icons=box`)
      expect(hit.status).toBe(200)
      expect(await hit.json()).toEqual(LUCIDE)
      expect(iconify.added).toEqual([LUCIDE])

      const unknown = await fetcher(`https://api2.iconify.design/mdi.json?icons=cancel`)
      expect(unknown.status).toBe(404)
      expect(loads).toBe(1)
      expect(network).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })

  test('the subset is fetched from the bundled path, and a failed load is retried', async () => {
    const iconify = iconifyDouble()
    const original = globalThis.fetch
    const requested: string[] = []
    let fail = true
    globalThis.fetch = (async (input: string) => {
      requested.push(String(input))
      return fail ? new Response('', { status: 404 }) : Response.json([LUCIDE])
    }) as unknown as typeof fetch
    try {
      configureAcdeIcons(iconify.registry, true)
      const fetcher = iconify.fetcher()!
      await expect(fetcher('https://api.iconify.design/lucide.json?icons=box')).rejects.toThrow(
        `${ACDE_ICON_SUBSET_URL}: HTTP 404`,
      )
      fail = false
      expect((await fetcher('https://api.iconify.design/lucide.json?icons=box')).status).toBe(200)
      expect(requested).toEqual([ACDE_ICON_SUBSET_URL, ACDE_ICON_SUBSET_URL])
    } finally {
      globalThis.fetch = original
    }
  })
})

test('with the real Iconify, icons load from the subset and others go missing without a request', async () => {
  const { _api, addCollection, iconLoaded, loadIcons } = await import('@iconify/react')
  const original = globalThis.fetch
  const network: string[] = []
  globalThis.fetch = (async (input: string) => {
    network.push(String(input))
    throw new Error('network')
  }) as unknown as typeof fetch
  try {
    const subset: IconifyJSON = { prefix: 'acde-test', icons: { box: { body: '<path/>' } } }
    configureAcdeIcons({ addCollection, setFetch: _api.setFetch }, true, async () => [subset])
    const result = await new Promise<{ loaded: string[]; missing: string[] }>((resolve) => {
      // called as each prefix settles; done when nothing is pending
      loadIcons(
        ['acde-test:box', 'acde-test:nope', 'acde-other:thing'],
        (loaded, missing, pending) => {
          if (pending.length) return
          resolve({
            loaded: loaded.map((icon) => `${icon.prefix}:${icon.name}`),
            missing: missing.map((icon) => `${icon.prefix}:${icon.name}`).sort(),
          })
        },
      )
    })
    expect(result).toEqual({
      loaded: ['acde-test:box'],
      missing: ['acde-other:thing', 'acde-test:nope'],
    })
    expect(iconLoaded('acde-test:box')).toBe(true)
    expect(network).toEqual([])
  } finally {
    globalThis.fetch = original
    _api.setFetch(original)
  }
})
