import { type AppWindow, type ConsoleEntry, expect } from 'acde/test'

/**
 * Session start plus a cold `next build` into `.acde/test` measured ~30 s on an
 * M-series Mac; the margin covers the editor page's first load.
 */
export const TEST_TIMEOUT_MS = 180_000

export const DEMO_BUILD = new URL('../public/demos/demo_1.json', import.meta.url).pathname

export interface ApiResult<T = unknown> {
  status: number
  json: T | null
}

/** Calls the app's own backend from inside the page, as the app's code would. */
export function api<T = unknown>(
  app: AppWindow,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<ApiResult<T>> {
  const request = {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  }
  return app.evaluate<ApiResult<T>>(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, ${JSON.stringify(request)})
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch {}
    return { status: response.status, json }
  })()`)
}

export interface SceneMeta {
  id: string
  name: string
  version: number
  nodeCount: number
}

export async function createSceneViaApi(app: AppWindow, name: string): Promise<SceneMeta> {
  const created = await api<SceneMeta>(app, '/api/scenes', {
    method: 'POST',
    body: { name, graph: { nodes: {}, rootNodeIds: [] } },
  })
  expect(created.status).toBe(201)
  return created.json as SceneMeta
}

/** Navigates the page; the evaluate returns before the old document goes away. */
export async function goto(app: AppWindow, path: string): Promise<void> {
  await app.evaluate(`setTimeout(() => location.assign(${JSON.stringify(path)}), 0); true`)
  await expect
    .poll(() => app.evaluate<string>('location.pathname'), { timeout: 30_000 })
    .toBe(path.split('?')[0])
}

export async function expectHome(app: AppWindow): Promise<void> {
  await expect(app.getByRole('button', { name: 'New project' }).first()).toBeVisible({
    timeout: 30_000,
  })
  expect(await app.evaluate<string>('location.pathname')).toBe('/')
}

/**
 * The editor's own scene-data state, which does not depend on the 3D canvas,
 * plus the full-pane loader that blocks pointer input until it comes down.
 */
export async function waitForEditorReady(app: AppWindow): Promise<void> {
  await expect(app.locator('html[data-scene-data="ready"]')).toHaveCount(1, { timeout: 60_000 })
  await expect(app.locator('[data-scene-loading]')).toHaveCount(0, { timeout: 30_000 })
}

export function sceneIdFromPath(pathname: string): string {
  const match = /^\/project\/([^/?#]+)/.exec(pathname)
  if (!match?.[1]) throw new Error(`not a project page: ${pathname}`)
  return match[1]
}

/** Uncaught exceptions and unhandled rejections, not `console.error` calls. */
export async function pageErrors(app: AppWindow): Promise<ConsoleEntry[]> {
  const found: ConsoleEntry[] = []
  let since: number | undefined
  for (;;) {
    const page = await app.console({ level: 'errors', since, limit: 1000 })
    for (const entry of page.entries) {
      if (entry.kind === 'error' || entry.kind === 'rejection') found.push(entry)
    }
    if (page.entries.length < 1000 || page.next === since) return found
    since = page.next
  }
}
