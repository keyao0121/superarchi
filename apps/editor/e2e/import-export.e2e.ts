import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'acde/test'
import {
  api,
  BUILD_FILE,
  createSceneViaApi,
  DEMO_BUILD,
  downloadsDir,
  expectHome,
  goto,
  graphContentDiff,
  graphShape,
  loadBuild,
  openSettingsTab,
  type SceneGraphJson,
  type SceneMeta,
  sceneGraphViaApi,
  TEST_TIMEOUT_MS,
  waitForDownload,
  waitForEditorReady,
} from './helpers'

/** The user's real Downloads, which a test must never write to. */
function realDownloads(): Record<string, number> {
  const dir = join(homedir(), 'Downloads')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    // No Downloads folder at all is an empty one; anything else must fail.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  return Object.fromEntries(
    names
      .filter((name) => name.startsWith('layout_'))
      .map((name) => [name, statSync(join(dir, name)).mtimeMs]),
  )
}

test('exports a build to the session Downloads and loads it into a new project', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app, acde, home }) => {
  const window = app!
  const realBefore = realDownloads()
  await expectHome(window)

  // Source project: the demo build as the editor normalizes and saves it.
  const source = await createSceneViaApi(window, 'Export source')
  await goto(window, `/project/${source.id}`)
  await waitForEditorReady(window)
  await openSettingsTab(window)
  await loadBuild(acde, window, source.id, DEMO_BUILD)
  const saved = await sceneGraphViaApi(window, source.id)
  expect(graphShape(saved).nodeIds.length).toBeGreaterThan(0)

  // Export: `<a download>` lands in this session's HOME, not the user's.
  await window.getByRole('button', { name: 'Save build' }).click()
  const exportedFile = await waitForDownload(home, BUILD_FILE)
  expect(exportedFile.startsWith(downloadsDir(home))).toBe(true)
  const exported = (await Bun.file(exportedFile).json()) as SceneGraphJson & {
    installedPlugins?: unknown
    materials?: unknown
    collections?: unknown
  }
  expect(Object.keys(exported).sort()).toEqual(
    ['collections', 'installedPlugins', 'materials', 'nodes', 'projectId', 'rootNodeIds'].sort(),
  )
  // Whole node contents, not just ids: geometry, parents, materials and all.
  expect(graphContentDiff(saved, exported)).toEqual([])

  // Round trip: load the exported file into a fresh project.
  await goto(window, '/')
  await expectHome(window)
  const target = await createSceneViaApi(window, 'Import target')
  await goto(window, `/project/${target.id}`)
  await waitForEditorReady(window)
  await openSettingsTab(window)
  await loadBuild(acde, window, target.id, exportedFile)
  expect(graphContentDiff(exported, await sceneGraphViaApi(window, target.id))).toEqual([])

  expect(realDownloads()).toEqual(realBefore)
})

test('rejects a broken build file and ignores a cancelled picker', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app, acde, home }) => {
  const window = app!
  await expectHome(window)
  const scene = await createSceneViaApi(window, 'Broken file')
  await goto(window, `/project/${scene.id}`)
  await waitForEditorReady(window)
  await openSettingsTab(window)
  const replace = window.getByRole('button', { name: 'Replace current scene' })

  // Cancelled picker: nothing to review.
  await acde.chooseFiles(null)
  await window.getByRole('button', { name: 'Load build' }).click()
  await window.evaluate('new Promise((resolve) => setTimeout(() => resolve(true), 1000))')
  await expect(replace).toHaveCount(0)

  // Not JSON: the review dialog says so and offers nothing to confirm.
  const broken = join(home, 'broken-build.json')
  writeFileSync(broken, '{ "nodes": { this is not json')
  await acde.chooseFiles([broken])
  await window.getByRole('button', { name: 'Load build' }).click()
  await expect(window.getByText('File could not be parsed as JSON.')).toBeVisible()
  await expect(replace).toBeDisabled()
  await window.getByRole('button', { name: 'Cancel' }).click()
  await expect(replace).toHaveCount(0)

  const after = await api<SceneMeta>(window, `/api/scenes/${scene.id}`)
  expect(after.json?.version).toBe(scene.version)
  expect(after.json?.nodeCount).toBe(0)
})

test('imports a build from a URL on the import page', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app }) => {
  const window = app!
  await expectHome(window)

  // Without `src` the page explains what is missing and offers no import.
  await goto(window, '/import')
  await expect(window.getByText('Missing `src` parameter.')).toBeVisible({ timeout: 30_000 })
  await expect(window.getByRole('button', { name: 'Import as a new scene' })).toHaveCount(0)

  // `http://localhost:<port>` reaches the app's own backend, which serves public/.
  const src = 'http://localhost:3000/demos/demo_1.json'
  await goto(window, `/import?src=${encodeURIComponent(src)}&name=Imported%20demo`)
  await expect(window.getByText(/^65 nodes/)).toBeVisible({ timeout: 30_000 })
  await expect(window.locator('main input')).toHaveValue('Imported demo')
  const create = window.waitForRequest('/api/scenes', { method: 'POST' })
  await window.getByRole('button', { name: 'Import as a new scene' }).click()
  expect((await create).status).toBe(201)
  await expect
    .poll(() => window.evaluate<string>('location.pathname'), { timeout: 30_000 })
    .toMatch(/^\/project\//)
  await waitForEditorReady(window)
  await expect(window.getByRole('button', { name: 'Imported demo' })).toBeVisible()

  const listed = await api<{ scenes: SceneMeta[] }>(window, '/api/scenes')
  expect(listed.json?.scenes.map((scene) => scene.name)).toEqual(['Imported demo'])
  expect(listed.json?.scenes[0]?.nodeCount).toBeGreaterThan(0)
})
