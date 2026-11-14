import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { guardSceneApiRequest } from '../scene-api-security'
import { resolveAuthMode } from '../self-host-auth'
import { ACDE_ORIGIN, applyAcdeServerEnv } from './server-env'

const acdeEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ACDE_APP_ID: 'pascal-editor',
  ACDE_APP_DATA: '/acde/apps/pascal-editor',
  ...extra,
})

describe('applyAcdeServerEnv', () => {
  test('leaves a backend outside acde untouched', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/home/me', PASCAL_DATA_DIR: undefined }
    const before = { ...env }
    applyAcdeServerEnv(env)
    expect(env).toEqual(before)
  })

  test('fills the acde defaults', () => {
    const env = acdeEnv()
    applyAcdeServerEnv(env)
    expect(env.PASCAL_DATA_DIR).toBe(path.join('/acde/apps/pascal-editor', 'data'))
    expect(env.PASCAL_AUTH).toBe('proxy')
    expect(env.PASCAL_SCENE_API_ORIGINS).toBe(ACDE_ORIGIN)
    expect(env.PASCAL_PUBLIC_URL).toBe(ACDE_ORIGIN)
  })

  test('keeps explicit configuration', () => {
    const env = acdeEnv({
      PASCAL_DATA_DIR: '/custom',
      PASCAL_AUTH: 'other',
      PASCAL_PUBLIC_URL: 'https://pascal.example',
    })
    applyAcdeServerEnv(env)
    expect(env.PASCAL_DATA_DIR).toBe('/custom')
    expect(env.PASCAL_AUTH).toBe('other')
    expect(env.PASCAL_PUBLIC_URL).toBe('https://pascal.example')
  })

  test('a configured password keeps password mode', () => {
    const env = acdeEnv({ PASCAL_ADMIN_PASSWORD: 'secret' })
    applyAcdeServerEnv(env)
    expect(env.PASCAL_AUTH).toBeUndefined()
    expect(resolveAuthMode(new Request(`${ACDE_ORIGIN}/`), env)).toBe('password')
  })

  test('appends the acde origin to configured origins once', () => {
    const env = acdeEnv({ PASCAL_SCENE_API_ORIGINS: 'https://a.example' })
    applyAcdeServerEnv(env)
    applyAcdeServerEnv(env)
    expect(env.PASCAL_SCENE_API_ORIGINS).toBe(`https://a.example,${ACDE_ORIGIN}`)
  })

  test('without ACDE_APP_DATA the data directory is left to the store defaults', () => {
    const env = acdeEnv({ ACDE_APP_DATA: undefined })
    applyAcdeServerEnv(env)
    expect(env.PASCAL_DATA_DIR).toBeUndefined()
  })

  test('acde requests are open whichever Host the runtime forwards', () => {
    const env = acdeEnv()
    applyAcdeServerEnv(env)
    for (const host of ['acde.local', 'localhost:3000']) {
      const request = new Request(`http://${host}/`, { headers: { host } })
      expect(resolveAuthMode(request, env)).toBe('open')
    }
  })
})

describe('scene API under acde', () => {
  const keys = ['PASCAL_AUTH', 'PASCAL_SCENE_API_ORIGINS', 'PASCAL_SCENE_API_TOKEN'] as const
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  test('accepts writes from the acde page origin whichever Host is forwarded', () => {
    const env = acdeEnv()
    applyAcdeServerEnv(env)
    process.env.PASCAL_AUTH = env.PASCAL_AUTH
    process.env.PASCAL_SCENE_API_ORIGINS = env.PASCAL_SCENE_API_ORIGINS
    delete process.env.PASCAL_SCENE_API_TOKEN

    for (const host of ['acde.local', 'localhost:3000']) {
      const request = new Request(`http://${host}/api/scenes`, {
        method: 'POST',
        headers: { host, origin: ACDE_ORIGIN },
      })
      expect(guardSceneApiRequest(request)).toBeNull()
    }
  })
})
