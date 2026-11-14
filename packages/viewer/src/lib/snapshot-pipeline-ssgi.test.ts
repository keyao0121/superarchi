import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'bun'

test('the snapshot pipeline builds SSGI only where its depth gather compiles (isolated process)', async () => {
  // The fixture replaces SSGINode with a counting module mock, and Bun module mocks persist across files.
  const fixture = fileURLToPath(new URL('./__tests__/snapshot-ssgi.fixture.ts', import.meta.url))
  const reportDir = await mkdtemp(join(tmpdir(), 'snapshot-ssgi-'))
  const reportFile = join(reportDir, 'report.xml')
  try {
    const child = spawn(
      [process.execPath, 'test', '--reporter=junit', `--reporter-outfile=${reportFile}`, fixture],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`)
    const summary = (await readFile(reportFile, 'utf8')).match(/<testsuites\b[^>]*>/)?.[0] ?? ''
    expect(summary).toContain('failures="0"')
    expect(Number(summary.match(/\btests="(\d+)"/)?.[1])).toBe(2)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
}, 60_000)
