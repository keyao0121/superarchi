import path from 'node:path'

/** Every acde app page has this origin. */
export const ACDE_ORIGIN = 'http://acde.local'

/**
 * Defaults for a backend started by the acde runtime, which builds the backend's
 * environment from scratch (no `.env`, nothing from the user's shell) and
 * identifies itself with `ACDE_APP_ID`. Only fills values that are unset, so
 * an explicit configuration still wins; without `ACDE_APP_ID` it does nothing.
 *
 * - Data lives in the app's private folder, `ACDE_APP_DATA`.
 * - The backend is reachable only through a unix socket that the runtime opens
 *   for this app's own pages, so the upstream-authenticates mode applies: the
 *   loopback check cannot be relied on because the forwarded `Host` is not
 *   documented.
 * - Pages post from `http://acde.local`, which must pass the scene API origin
 *   check whatever `Host` the request carries.
 */
export function applyAcdeServerEnv(env: NodeJS.ProcessEnv): void {
  if (!env.ACDE_APP_ID) return

  if (!env.PASCAL_DATA_DIR && env.ACDE_APP_DATA) {
    env.PASCAL_DATA_DIR = path.join(env.ACDE_APP_DATA, 'data')
  }
  if (!env.PASCAL_AUTH && !env.PASCAL_ADMIN_PASSWORD) {
    env.PASCAL_AUTH = 'proxy'
  }
  const origins = (env.PASCAL_SCENE_API_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (!origins.includes(ACDE_ORIGIN)) {
    env.PASCAL_SCENE_API_ORIGINS = [...origins, ACDE_ORIGIN].join(',')
  }
  if (!env.PASCAL_PUBLIC_URL) {
    env.PASCAL_PUBLIC_URL = ACDE_ORIGIN
  }
}
