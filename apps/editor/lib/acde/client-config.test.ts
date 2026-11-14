import { expect, test } from 'bun:test'
import { ACDE_ASSETS_BASE_URL, acdeViewerConfig, shouldLoadWebXR } from './client-config'

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
