import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const appDirectory = path.resolve(import.meta.dir, '..')
const repositoryRoot = path.resolve(appDirectory, '../..')
const ICON_LITERAL = /['"`](\/icons\/[\w./-]+\.(?:webp|png|svg))['"`]/g
const SKIPPED = new Set(['node_modules', 'dist', '.next', '.acde', '__fixtures__', 'public'])

function sources(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })
}

// The page loads these same-origin (iconsBaseUrl '/icons'); acde serves them from the
// bundled public/ copy, so a missing file would surface as a failed request there.
test('every /icons/ file the editor names ships in public/icons', () => {
  const roots = [
    appDirectory,
    ...readdirSync(path.join(repositoryRoot, 'packages')).map((name) =>
      path.join(repositoryRoot, 'packages', name, 'src'),
    ),
  ]
  const named = new Set<string>()
  for (const file of roots.flatMap(sources)) {
    for (const match of readFileSync(file, 'utf8').matchAll(ICON_LITERAL)) {
      named.add(match[1] as string)
    }
  }
  expect(named).toContain('/icons/window.webp')
  const missing = [...named].filter((icon) => !existsSync(path.join(appDirectory, 'public', icon)))
  expect(missing).toEqual([])
})
