import { expect, test } from 'acde/test'
import { startScriptedModel } from '../lib/agent/__fixtures__/scripted-model'
import {
  api,
  createSceneViaApi,
  editorGraphViaExport,
  expectHome,
  goto,
  pageErrors,
  type SceneGraphJson,
  TEST_TIMEOUT_MS,
  waitForEditorReady,
} from './helpers'

function wallIds(graph: SceneGraphJson): string[] {
  return Object.keys(graph.nodes).filter((id) => id.startsWith('wall_'))
}

test('the AI team builds what the Boss is told, in the open project, and takes it back', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app, home }) => {
  const window = app!
  const model = await startScriptedModel()
  try {
    await expectHome(window)
    const scene = await createSceneViaApi(window, 'AI team')
    await goto(window, `/project/${scene.id}`)
    await waitForEditorReady(window)

    // Without a model the Boss says so instead of working.
    const panel = window.locator('[data-agent-panel]')
    await expect(panel).toHaveCount(1)
    const say = window.getByRole('textbox', { name: 'Tell the Boss…' })
    await say.fill('加一道隔墙')
    await window.getByRole('button', { name: 'Send' }).click()
    await expect(window.locator('[data-agent-panel="error"]')).toHaveCount(1, { timeout: 30_000 })
    await expect(
      window.getByText('Set up a model first: the Boss needs one to work.'),
    ).toBeVisible()

    // The person saves a model; the key never comes back to the page.
    const saved = await api<{ baseUrl: string; model: string; hasApiKey: boolean }>(
      window,
      '/api/agent/settings',
      { method: 'PUT', body: { baseUrl: model.baseUrl, model: 'scripted', apiKey: 'test-key' } },
    )
    expect(saved.status).toBe(200)
    expect(saved.json).toEqual({ baseUrl: model.baseUrl, model: 'scripted', hasApiKey: true })

    // One sentence to the Boss: tasks on the board, the wall in the editor.
    await say.fill('加一道隔墙')
    await window.getByRole('button', { name: 'Send' }).click()
    await expect(window.locator('[data-agent-panel="review"]')).toHaveCount(1, { timeout: 60_000 })
    await expect(window.getByText('收到，拆成 2 个任务。')).toBeVisible()
    await expect(window.getByText('已完成，等你验收。')).toBeVisible()
    await expect(
      window.locator('[data-board-column="review"] [data-task-status="review"]'),
    ).toHaveCount(2)
    await expect(window.locator('[data-change-status="applied"]')).toHaveCount(1)
    await expect
      .poll(async () => wallIds(await editorGraphViaExport(window, home)).length, {
        timeout: 30_000,
      })
      .toBe(1)

    // Revert puts the open project back as it stood before the request.
    await window.getByRole('button', { name: 'Revert' }).click()
    await expect(window.locator('[data-agent-panel="idle"]')).toHaveCount(1, { timeout: 30_000 })
    await expect(window.locator('[data-change-status="reverted"]')).toHaveCount(1)
    await expect
      .poll(async () => wallIds(await editorGraphViaExport(window, home)).length, {
        timeout: 30_000,
      })
      .toBe(0)

    expect(model.requests.every((request) => request.authorization === 'Bearer test-key')).toBe(
      true,
    )
    expect(await pageErrors(window)).toEqual([])
  } finally {
    await model.stop()
  }
})
