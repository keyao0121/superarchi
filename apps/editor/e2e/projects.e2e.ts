import { expect, test } from 'acde/test'
import {
  api,
  createSceneViaApi,
  DEMO_BUILD,
  expectHome,
  goto,
  pageErrors,
  type SceneMeta,
  sceneIdFromPath,
  TEST_TIMEOUT_MS,
  waitForEditorReady,
} from './helpers'

// Every test runs in a fresh session with an empty HOME, so each starts from an
// empty project list and reopening a project happens within the same test.

test('opens on the project list, serves the settings page and round-trips the scene API', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app }) => {
  const window = app!

  // Open: the list itself, not /setup or /login.
  await expectHome(window)
  await expect(
    window.getByText('Your projects live here. Start one to begin designing.'),
  ).toBeVisible()

  const health = await api<{ status: string; app: string }>(window, '/api/health')
  expect(health.status).toBe(200)
  expect(health.json).toMatchObject({ status: 'ok', app: 'editor' })

  // Settings: reachable from the header, data in the acde app folder.
  await window.getByRole('link', { name: 'Settings' }).click()
  await expect(window.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({
    timeout: 30_000,
  })
  await expect(window.getByText(/\/acde\/apps\/pascal-editor\/data$/)).toBeVisible()
  await expect(window.getByText('~/.pascal/data')).toHaveCount(0)
  await window.getByRole('link', { name: 'All projects' }).click()
  await expectHome(window)

  // Scene API against SQLite: create, read, rename, list, stale write, delete.
  const listedEmpty = await api<{ scenes: SceneMeta[] }>(window, '/api/scenes')
  expect(listedEmpty.status).toBe(200)
  expect(listedEmpty.json?.scenes).toEqual([])

  const created = await createSceneViaApi(window, 'API round trip')
  const read = await api<SceneMeta>(window, `/api/scenes/${created.id}`)
  expect(read.status).toBe(200)
  expect(read.json?.name).toBe('API round trip')

  const renamed = await api<SceneMeta>(window, `/api/scenes/${created.id}`, {
    method: 'PATCH',
    headers: { 'If-Match': `"${created.version}"` },
    body: { name: 'API round trip renamed' },
  })
  expect(renamed.status).toBe(200)

  const listed = await api<{ scenes: SceneMeta[] }>(window, '/api/scenes')
  expect(listed.json?.scenes.map((scene) => scene.name)).toEqual(['API round trip renamed'])

  const stale = await api(window, `/api/scenes/${created.id}`, {
    method: 'PATCH',
    headers: { 'If-Match': `"${created.version}"` },
    body: { name: 'Lost update' },
  })
  expect(stale.status).toBe(409)

  const deleted = await api(window, `/api/scenes/${created.id}`, {
    method: 'DELETE',
    headers: { 'If-Match': `"${renamed.json?.version}"` },
  })
  expect(deleted.status).toBe(204)
  expect((await api(window, `/api/scenes/${created.id}`)).status).toBe(404)

  // An unknown project renders its own page instead of crashing.
  await goto(window, '/project/does-not-exist')
  await expect(window.getByRole('heading', { name: 'Project not found' })).toBeVisible({
    timeout: 30_000,
  })
})

test('creates a project, saves an imported scene and reopens it', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app, acde }) => {
  const window = app!
  await expectHome(window)

  // Create: the empty state shows the button twice (header and body).
  const create = window.waitForRequest('/api/scenes', { method: 'POST' })
  await window.getByRole('button', { name: 'New project' }).first().click()
  expect((await create).status).toBe(201)
  await expect
    .poll(() => window.evaluate<string>('location.pathname'), { timeout: 30_000 })
    .toMatch(/^\/project\//)
  const sceneId = sceneIdFromPath(await window.evaluate<string>('location.pathname'))
  await waitForEditorReady(window)
  await expect(window.getByRole('button', { name: 'Project #1' })).toBeVisible()

  // Fill the scene without the 3D canvas: Settings → Load build → confirm.
  await window.getByRole('button', { name: 'Settings', exact: true }).click()
  await acde.chooseFiles([DEMO_BUILD])
  await window.getByRole('button', { name: 'Load build' }).click()
  const save = window.waitForRequest(`/api/scenes/${sceneId}`, { method: 'PUT' })
  await window.getByRole('button', { name: 'Replace current scene' }).click()
  expect((await save).status).toBe(200)

  const saved = await api<SceneMeta>(window, `/api/scenes/${sceneId}`)
  expect(saved.json?.version).toBeGreaterThan(1)
  const nodeCount = saved.json?.nodeCount ?? 0
  expect(nodeCount).toBeGreaterThan(0)

  // Reopen with a full page load, which reads the scene back from the server.
  // Not `window.reload()`: this page was reached with a client-side push, and
  // acde reloads the last fully loaded document (`/`), not the pushed URL.
  await goto(window, '/')
  await expectHome(window)
  await goto(window, `/project/${sceneId}`)
  await waitForEditorReady(window)
  await expect(window.getByRole('button', { name: 'Project #1' })).toBeVisible()
  const reopened = await api<SceneMeta>(window, `/api/scenes/${sceneId}`)
  expect(reopened.json?.nodeCount).toBe(nodeCount)
  expect(reopened.json?.version).toBe(saved.json?.version)

  // And from the list, which shows what was saved.
  await window.getByRole('link', { name: 'All projects' }).click()
  await expectHome(window)
  const card = window.getByRole('link', { name: new RegExp(`^Project #1 ${nodeCount} nodes`) })
  await expect(card).toBeVisible()
  await card.click()
  await expect
    .poll(() => window.evaluate<string>('location.pathname'), { timeout: 30_000 })
    .toBe(`/project/${sceneId}`)
  await waitForEditorReady(window)
})

test('renames and deletes projects from the editor and the list', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app }) => {
  const window = app!
  await expectHome(window)
  const scene = await createSceneViaApi(window, 'Rename me')

  // Rename in the editor's title bar.
  await goto(window, `/project/${scene.id}`)
  await waitForEditorReady(window)
  await window.getByRole('button', { name: 'Rename me' }).click()
  await window.getByRole('textbox', { name: 'Project name' }).fill('Renamed in editor')
  const titleRename = window.waitForRequest(`/api/scenes/${scene.id}`, { method: 'PATCH' })
  await window.getByRole('textbox', { name: 'Project name' }).press('enter')
  expect((await titleRename).status).toBe(200)
  await expect(window.getByRole('button', { name: 'Renamed in editor' })).toBeVisible()

  // The rename survives a reload.
  await window.reload()
  await waitForEditorReady(window)
  await expect(window.getByRole('button', { name: 'Renamed in editor' })).toBeVisible()

  // Rename from the list card's modal dialog.
  await window.getByRole('link', { name: 'All projects' }).click()
  await expectHome(window)
  await window.getByRole('button', { name: 'Actions for Renamed in editor' }).click()
  await window.getByRole('menuitem', { name: 'Rename' }).click()
  await window.getByRole('textbox', { name: 'Project name' }).fill('Renamed in list')
  await window.getByRole('button', { name: 'Save' }).click()
  await expect(window.getByRole('heading', { name: 'Renamed in list', level: 2 })).toBeVisible()
  expect((await api<SceneMeta>(window, `/api/scenes/${scene.id}`)).json?.name).toBe(
    'Renamed in list',
  )

  // Delete from the list card's modal dialog.
  await window.getByRole('button', { name: 'Actions for Renamed in list' }).click()
  await window.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(window.getByRole('heading', { name: 'Delete project?' })).toBeVisible()
  await window.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(
    window.getByText('Your projects live here. Start one to begin designing.'),
  ).toBeVisible()
  expect((await api(window, `/api/scenes/${scene.id}`)).status).toBe(404)
})

// Known issue T26: opening a project under acde throws `Worker is not defined`.
// The second expectation pins it so this test fails once T26 lands; then drop it
// and keep only the first. Any other uncaught error fails the test today.
test('project page raises no uncaught errors (known issue T26)', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app }) => {
  const window = app!
  await expectHome(window)
  const scene = await createSceneViaApi(window, 'Page errors')
  await goto(window, `/project/${scene.id}`)
  await waitForEditorReady(window)

  const known = (text: string) => text.includes('Worker is not defined')
  await expect
    .poll(async () => (await pageErrors(window)).some((entry) => known(entry.text)), {
      timeout: 20_000,
      message: 'T26 seems fixed: remove the known-issue expectation from this test',
    })
    .toBe(true)

  const unexpected = (await pageErrors(window))
    .filter((entry) => !known(entry.text))
    .map((entry) => entry.text)
  expect(unexpected).toEqual([])
})
