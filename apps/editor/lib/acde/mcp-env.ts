import os from 'node:os'
import path from 'node:path'
import { acdeSceneDataDir } from './server-env'

/** `id` in `acde.config.jsonc`. */
export const ACDE_APP_ID = 'pascal-editor'

/**
 * Points a Pascal MCP server started outside the acde runtime (by an agent on
 * the same machine) at the projects of the installed acde app. The runtime
 * gives the app's backend `$XDG_DATA_HOME/acde/apps/<id>` as `ACDE_APP_DATA`;
 * sharing that scene database is what lets the open editor follow the agent's
 * edits. An explicit `PASCAL_DATA_DIR` or `PASCAL_DB_PATH` wins.
 */
export function applyAcdeMcpEnv(env: NodeJS.ProcessEnv, home: string = os.homedir()): void {
  if (env.PASCAL_DATA_DIR || env.PASCAL_DB_PATH) return
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  env.PASCAL_DATA_DIR = acdeSceneDataDir(path.join(dataHome, 'acde', 'apps', ACDE_APP_ID))
}
