import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelSettingsView, readModelSettings, writeModelSettings } from './settings'

const directories: string[] = []
function settingsFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pascal-agent-settings-'))
  directories.push(directory)
  return join(directory, 'nested', 'agent-model.json')
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('model settings', () => {
  const settings = { baseUrl: 'https://model.example/v1', model: 'm-1', apiKey: 'secret' }

  test('are kept in a file only the owner reads', async () => {
    const path = settingsFile()
    expect(await readModelSettings(path)).toBeNull()
    await writeModelSettings(settings, path)
    expect(await readModelSettings(path)).toEqual(settings)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  test('read as unset when the file is not valid settings', async () => {
    const path = settingsFile()
    await writeModelSettings(settings, path)
    writeFileSync(path, '{"baseUrl":"not a url"}')
    expect(await readModelSettings(path)).toBeNull()
  })

  test('never show the key to a page', () => {
    expect(modelSettingsView(settings)).toEqual({
      baseUrl: 'https://model.example/v1',
      model: 'm-1',
      hasApiKey: true,
    })
    expect(JSON.stringify(modelSettingsView(settings))).not.toContain('secret')
    expect(modelSettingsView(null)).toEqual({ baseUrl: '', model: '', hasApiKey: false })
  })
})
