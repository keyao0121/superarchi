// Bundles the AI team's scene host (`lib/agent/scene-host.ts`) into one module
// the backend imports at run time. Next cannot bundle it: see that file.
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sceneHostSource = path.join(appDirectory, 'lib/agent/scene-host.ts')

/** Writes the bundle to `outfile`; true when its bytes changed. */
export async function bundleSceneHost(outfile: string): Promise<boolean> {
  await mkdir(path.dirname(outfile), { recursive: true })
  const partial = `${outfile}.partial`
  // Target node, as the CLI bundles the MCP service: the backend runs on Bun or Node, and the
  // scene store picks its SQLite driver when it opens. Whitespace only, so names stay as written.
  const child = spawn(
    'bun',
    [
      'build',
      sceneHostSource,
      '--outfile',
      partial,
      '--target',
      'node',
      '--format',
      'esm',
      '--minify-whitespace',
    ],
    { cwd: appDirectory, stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    await rm(partial, { force: true })
    throw new Error(`Unable to bundle the scene host: ${Buffer.concat(stderr).toString()}`)
  }
  const [next, current] = await Promise.all([
    readFile(partial),
    readFile(outfile).catch(() => null),
  ])
  if (current?.equals(next)) {
    await rm(partial)
    return false
  }
  await rename(partial, outfile)
  return true
}
