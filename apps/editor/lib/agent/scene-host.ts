/**
 * The Pascal MCP server run in-process, for the AI team's backend.
 *
 * Next must never bundle this file: `@pascal-app/core`'s scene store is a
 * `'use client'` module, which a route's server bundle replaces with a client
 * reference that has no state. `scripts/acde/agent-host.ts` bundles this file
 * on its own instead and `scene-agent.ts` imports that bundle at run time, so
 * import only this file's types from app code.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { SceneBridge } from '@pascal-app/mcp/bridge'
import { createSceneOperations } from '@pascal-app/mcp/operations'
import { createPascalMcpServer } from '@pascal-app/mcp/server'
import { createSceneStore } from '@pascal-app/mcp/storage'
import { publishLiveSceneSnapshot } from '@pascal-app/mcp/tools/live-sync'

export interface SceneHostTool {
  name: string
  title: string
  readOnly: boolean
  description: string
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>
}

export interface SceneToolResult {
  text: string
  /** The tool answered with an error: nothing changed. */
  refused: boolean
}

export interface SceneHost {
  tools: SceneHostTool[]
  /** Rejects when the server itself fails the call, e.g. `live_sync_version_conflict`. */
  callTool(name: string, args: Record<string, unknown>): Promise<SceneToolResult>
  /** The nodes of the scene the session holds. */
  nodes(): Record<string, unknown>
  /** Replaces the session's scene with the default scaffold: a site, a building, one level. */
  loadDefaultScene(): void
  /** A copy of the session's scene, for `restore`. */
  snapshot(): unknown
  /** Saves `snapshot` as the stored scene's next version and tells the open editor. */
  restore(sceneId: string, snapshot: unknown): Promise<void>
}

type SceneGraph = ReturnType<ReturnType<typeof createSceneOperations>['exportSceneGraph']>

export async function createSceneHost(env: NodeJS.ProcessEnv = process.env): Promise<SceneHost> {
  const store = await createSceneStore(env)
  const bridge = new SceneBridge()
  bridge.loadDefault()
  bridge.clearHistory()
  const operations = createSceneOperations({ bridge, store })
  // The furnishing tools would otherwise wait for a design brief, whose schema alone is larger
  // than everything else an employee is offered.
  operations.designBriefRequired = false
  const server = createPascalMcpServer({ bridge, operations, store })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'pascal-editor-assistant', version: '1.0.0' })
  await client.connect(clientTransport)

  const tools: SceneHostTool[] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    for (const tool of page.tools) {
      const { $schema: _dialect, ...parameters } = tool.inputSchema as Record<string, unknown>
      tools.push({
        name: tool.name,
        title: tool.title ?? tool.name,
        readOnly: tool.annotations?.readOnlyHint === true,
        description: tool.description ?? '',
        parameters,
      })
    }
    cursor = page.nextCursor
  } while (cursor)

  return {
    tools,
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args })
      const content = Array.isArray(result.content) ? result.content : []
      const structured = result.structuredContent as Record<string, unknown> | undefined
      return {
        text: content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .filter(Boolean)
          .join('\n'),
        refused:
          result.isError === true ||
          (typeof structured?.error === 'string' && 'code' in structured),
      }
    },
    nodes: () => operations.getNodes(),
    loadDefaultScene: () => operations.loadDefault(),
    snapshot: () => structuredClone(operations.exportSceneGraph()),
    async restore(sceneId, snapshot) {
      const stored = await operations.loadStoredScene(sceneId)
      if (!stored) throw new Error('scene_not_found')
      operations.loadJSON(snapshot as SceneGraph)
      operations.setActiveScene(stored)
      await publishLiveSceneSnapshot(operations, 'agent_revert')
    },
  }
}
