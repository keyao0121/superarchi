import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ACDE_APP_ID, applyAcdeMcpEnv } from './mcp-env'
import { applyAcdeServerEnv } from './server-env'

describe('applyAcdeMcpEnv', () => {
  test('names the app as acde.config.jsonc does', () => {
    const config = readFileSync(path.join(import.meta.dir, '../../acde.config.jsonc'), 'utf8')
    expect(/^\s*"id":\s*"([^"]+)"/m.exec(config)?.[1]).toBe(ACDE_APP_ID)
  })

  test('uses the scene database the app backend uses', () => {
    const backend: NodeJS.ProcessEnv = {
      ACDE_APP_ID,
      ACDE_APP_DATA: path.join('/home/me', '.local', 'share', 'acde', 'apps', ACDE_APP_ID),
    }
    applyAcdeServerEnv(backend)

    const agent: NodeJS.ProcessEnv = {}
    applyAcdeMcpEnv(agent, '/home/me')
    expect(agent.PASCAL_DATA_DIR).toBe(backend.PASCAL_DATA_DIR)
  })

  test('follows XDG_DATA_HOME', () => {
    const env: NodeJS.ProcessEnv = { XDG_DATA_HOME: '/data' }
    applyAcdeMcpEnv(env, '/home/me')
    expect(env.PASCAL_DATA_DIR).toBe(path.join('/data', 'acde', 'apps', ACDE_APP_ID, 'data'))
  })

  test('keeps an explicit database', () => {
    const byDirectory: NodeJS.ProcessEnv = { PASCAL_DATA_DIR: '/custom' }
    applyAcdeMcpEnv(byDirectory, '/home/me')
    expect(byDirectory).toEqual({ PASCAL_DATA_DIR: '/custom' })

    const byFile: NodeJS.ProcessEnv = { PASCAL_DB_PATH: '/custom/pascal.db' }
    applyAcdeMcpEnv(byFile, '/home/me')
    expect(byFile).toEqual({ PASCAL_DB_PATH: '/custom/pascal.db' })
  })
})
