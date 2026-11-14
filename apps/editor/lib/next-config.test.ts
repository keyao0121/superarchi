import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import type { NextConfig } from 'next'

const FLAGS = [
  'PASCAL_PORTABLE_BUILD',
  'NEXT_PRIVATE_STANDALONE',
  'NEXT_PUBLIC_ASSETS_CDN_URL',
] as const
const saved = Object.fromEntries(FLAGS.map((flag) => [flag, process.env[flag]]))
const repoRoot = path.resolve(import.meta.dir, '../../..')
let loadCount = 0

// next.config.ts reads the environment when it is evaluated; a fresh query
// string gives a fresh module instance for each case.
async function loadConfig(env: Partial<Record<(typeof FLAGS)[number], string>>) {
  for (const flag of FLAGS) {
    if (env[flag] === undefined) delete process.env[flag]
    else process.env[flag] = env[flag]
  }
  loadCount += 1
  const mod = (await import(`../next.config.ts?case=${loadCount}`)) as { default: NextConfig }
  return mod.default
}

afterEach(() => {
  for (const flag of FLAGS) {
    if (saved[flag] === undefined) delete process.env[flag]
    else process.env[flag] = saved[flag]
  }
})

describe('next.config portable build', () => {
  test('a plain build keeps image optimization and Next’s default output', async () => {
    const config = await loadConfig({})
    expect(config.output).toBeUndefined()
    expect(config.outputFileTracingRoot).toBeUndefined()
    expect(config.images?.unoptimized).toBe(false)
  })

  test('NEXT_PRIVATE_STANDALONE alone does not switch on the portable settings', async () => {
    const config = await loadConfig({ NEXT_PRIVATE_STANDALONE: '1' })
    expect(config.output).toBeUndefined()
    expect(config.outputFileTracingRoot).toBeUndefined()
    expect(config.images?.unoptimized).toBe(false)
  })

  test('PASCAL_PORTABLE_BUILD=1 builds standalone, traced from the repo root, unoptimized', async () => {
    const config = await loadConfig({ PASCAL_PORTABLE_BUILD: '1' })
    expect(config.output).toBe('standalone')
    expect(config.outputFileTracingRoot).toBe(repoRoot)
    expect(config.images?.unoptimized).toBe(true)
  })
})
