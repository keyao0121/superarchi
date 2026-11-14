const ACDERT_USER_AGENT = /\bacdert\/\d/

export type AcdeProbe = {
  hasWindow: boolean
  userAgent?: string
  env?: Record<string, string | undefined>
}

/**
 * Pages identify acdert by its user agent; backends by the `ACDE_APP_ID` the
 * runtime sets. Bun and Node expose `navigator.userAgent` on the server too,
 * so the browser test is `window`, never `navigator`.
 */
export function detectAcde(probe: AcdeProbe): boolean {
  if (probe.hasWindow) return ACDERT_USER_AGENT.test(probe.userAgent ?? '')
  return Boolean(probe.env?.ACDE_APP_ID)
}

/** Whether this code runs inside the acde runtime (acdert page or app backend). */
export function isAcde(): boolean {
  const scope = globalThis as {
    window?: unknown
    navigator?: { userAgent?: string }
    process?: { env?: Record<string, string | undefined> }
  }
  return detectAcde({
    hasWindow: typeof scope.window !== 'undefined',
    userAgent: scope.navigator?.userAgent,
    env: scope.process?.env,
  })
}

export type AcdeModuleName = 'window' | 'capabilities'

// A variable specifier, as in print-shell-compiler-manifold-core.ts, so
// bundlers leave the `acde:` import to the runtime instead of resolving it.
function importUntraced(specifier: string): Promise<{ default?: unknown }> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)
}

/** Loads an `acde:` module; null outside acde or when the runtime does not grant it. */
export async function loadAcdeModule<Module>(name: AcdeModuleName): Promise<Module | null> {
  if (!isAcde()) return null
  try {
    const mod = await importUntraced(`acde:${name}`)
    return (mod.default ?? mod) as Module
  } catch {
    return null
  }
}
