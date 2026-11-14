import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'bun'

test('the real <Viewer> without WebGPU or WebGL runs in an isolated process', async () => {
  // The fixture replaces <Canvas>, three/webgpu and the fallback with module
  // mocks, and Bun module mocks persist across files.
  const fixture = fileURLToPath(
    new URL('./__tests__/viewer-unsupported-gpu.fixture.tsx', import.meta.url),
  )
  const reportDir = await mkdtemp(join(tmpdir(), 'viewer-unsupported-gpu-'))
  const reportFile = join(reportDir, 'report.xml')
  try {
    const child = spawn(
      [process.execPath, 'test', '--reporter=junit', `--reporter-outfile=${reportFile}`, fixture],
      {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
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
