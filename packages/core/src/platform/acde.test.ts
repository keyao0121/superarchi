import { describe, expect, test } from 'bun:test'
import { detectAcde, isAcde, loadAcdeModule } from './acde'

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const ACDERT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) acdert/0.0.11'

describe('detectAcde', () => {
  test.each([
    ['a browser page', { hasWindow: true, userAgent: CHROME_UA }, false],
    ['an acdert page', { hasWindow: true, userAgent: ACDERT_UA }, true],
    ['a page without a user agent', { hasWindow: true }, false],
    [
      'a page whose user agent only mentions acdert',
      { hasWindow: true, userAgent: 'acdert' },
      false,
    ],
    ['an acde backend', { hasWindow: false, env: { ACDE_APP_ID: 'pascal-editor' } }, true],
    ['a plain server', { hasWindow: false, env: {} }, false],
    ['a server with an empty ACDE_APP_ID', { hasWindow: false, env: { ACDE_APP_ID: '' } }, false],
    [
      'a server whose navigator mentions acdert',
      { hasWindow: false, userAgent: ACDERT_UA, env: {} },
      false,
    ],
    [
      'a page whose env has ACDE_APP_ID',
      { hasWindow: true, userAgent: CHROME_UA, env: { ACDE_APP_ID: 'pascal-editor' } },
      false,
    ],
  ])('%s', (_, probe, expected) => {
    expect(detectAcde(probe)).toBe(expected)
  })
})

describe('isAcde', () => {
  test('is false under bun test', () => {
    expect(isAcde()).toBe(false)
  })

  test('follows ACDE_APP_ID on the server', () => {
    const saved = process.env.ACDE_APP_ID
    process.env.ACDE_APP_ID = 'pascal-editor'
    try {
      expect(isAcde()).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.ACDE_APP_ID
      else process.env.ACDE_APP_ID = saved
    }
  })
})

describe('loadAcdeModule', () => {
  test('is null outside acde', async () => {
    expect(await loadAcdeModule('window')).toBeNull()
  })

  test('is null when the runtime does not provide the module', async () => {
    const saved = process.env.ACDE_APP_ID
    process.env.ACDE_APP_ID = 'pascal-editor'
    try {
      expect(await loadAcdeModule('window')).toBeNull()
    } finally {
      if (saved === undefined) delete process.env.ACDE_APP_ID
      else process.env.ACDE_APP_ID = saved
    }
  })
})
