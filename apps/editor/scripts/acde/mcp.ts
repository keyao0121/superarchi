// Runs the Pascal MCP server on the installed acde app's projects, so an agent
// edits what the editor shows: it calls `load_scene` with the open project's id and
// the editor follows each edit. Arguments go to `pascal-mcp` (stdio by default).
//
// An MCP client on the same machine runs `bun <repo>/apps/editor/scripts/acde/mcp.ts`
// as a stdio server; one on another machine runs the same command through `ssh`.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyAcdeMcpEnv } from '../../lib/acde/mcp-env'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const server = path.resolve(scriptDirectory, '../../../../packages/mcp/dist/bin/pascal-mcp.js')

if (!existsSync(server)) {
  console.error(`[acde:mcp] ${server} is missing: run \`bun run build\` at the repository root.`)
  process.exit(1)
}

applyAcdeMcpEnv(process.env)
console.error(`[acde:mcp] projects in ${process.env.PASCAL_DB_PATH ?? process.env.PASCAL_DATA_DIR}`)
import(pathToFileURL(server).href)
