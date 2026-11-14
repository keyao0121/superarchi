import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { expect, test } from 'acde/test'
import {
  createSceneViaApi,
  DEMO_BUILD,
  editorGraphViaExport,
  expectHome,
  goto,
  loadBuild,
  openSettingsTab,
  pageErrors,
  type SceneMeta,
  sceneGraphViaApi,
  TEST_TIMEOUT_MS,
  waitForEditorReady,
} from './helpers'

const MCP_LAUNCHER = fileURLToPath(new URL('../scripts/acde/mcp.ts', import.meta.url))

/**
 * An agent on the same machine as the app: the session's home and data home are
 * all the launcher has to find where the app keeps its projects. A test session
 * keeps its data home beside its home, not under it.
 */
async function connectAgent(home: string): Promise<Client> {
  const client = new Client({ name: 'pascal-e2e-agent', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: [MCP_LAUNCHER],
      env: {
        HOME: home,
        PATH: process.env.PATH ?? '',
        XDG_DATA_HOME: join(home, '..', 'data'),
      },
      stderr: 'inherit',
    }),
  )
  return client
}

async function callTool<T>(agent: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await agent.callTool({ name, arguments: args })
  expect(result.isError ?? false, `${name}: ${JSON.stringify(result.content)}`).toBe(false)
  return result.structuredContent as T
}

test('an agent editing over MCP changes the project open in the editor', {
  timeout: TEST_TIMEOUT_MS,
}, async ({ app, acde, home }) => {
  const window = app!
  await expectHome(window)

  const scene = await createSceneViaApi(window, 'Agent edit')
  await goto(window, `/project/${scene.id}`)
  await waitForEditorReady(window)
  await openSettingsTab(window)
  await loadBuild(acde, window, scene.id, DEMO_BUILD)

  const agent = await connectAgent(home)
  try {
    // The agent sees the app's own projects, not a database of its own.
    const listed = await callTool<{ scenes: SceneMeta[] }>(agent, 'list_scenes')
    expect(listed.scenes.map((entry) => entry.id)).toEqual([scene.id])
    await callTool(agent, 'load_scene', { id: scene.id })

    // Each edit reaches the open editor through the scene's event stream, and
    // the editor taking the first one does not make the second one stale.
    for (const z of [1, 2]) {
      const wall = await callTool<{ wallId: string }>(agent, 'add_wall', {
        start: [1, z],
        end: [3, z],
      })
      await expect
        .poll(async () => wall.wallId in (await editorGraphViaExport(window, home)).nodes, {
          timeout: 30_000,
        })
        .toBe(true)
      expect(wall.wallId in (await sceneGraphViaApi(window, scene.id)).nodes).toBe(true)
    }
  } finally {
    await agent.close()
  }

  expect(await pageErrors(window)).toEqual([])
})
