import { expect, test } from 'bun:test'
import {
  ACDE_ASSETS_BASE_URL,
  ACDE_MANIFOLD_RUNTIME,
  acdeViewerConfig,
  configureAcdeManifold,
  shouldLoadWebXR,
} from './client-config'

test('outside acde the viewer config is left as the host sets it', () => {
  expect(acdeViewerConfig(false)).toEqual({})
  // bun test is a server-like scope without ACDE_APP_ID, so the default is "not acde"
  expect(acdeViewerConfig()).toEqual({})
})

test('under acde catalog assets resolve against the page origin', () => {
  expect(acdeViewerConfig(true)).toEqual({ assetsBaseUrl: ACDE_ASSETS_BASE_URL })
  expect(new URL(ACDE_ASSETS_BASE_URL).origin).toBe('http://acde.local')
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
