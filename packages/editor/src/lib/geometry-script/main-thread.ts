import type { GeometryScriptParamValue } from '@pascal-app/core'
import { sdfChecksOn } from '@pascal-app/core/usage-field'
import type { GeometryScriptCompileOutput } from '@pascal-app/geometry-script'

/**
 * Compiles a geometry script on the page's own thread, for runtimes without Web Workers
 * (acde). There is no sandbox frame or worker here: the compiler shadows the ambient
 * capabilities (`shadowGlobals`) as a deterrent only. A synchronous loop in the script
 * cannot be stopped; the timeout only stops waiting for it.
 */
export async function compileGeometryScriptOnMainThread(
  input: {
    code: string
    params?: Record<string, GeometryScriptParamValue>
    inputs?: Record<string, unknown>
  },
  timeoutMs: number,
): Promise<GeometryScriptCompileOutput> {
  const { compileGeometryScript } = await import('@pascal-app/geometry-script/compile')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out after ${timeoutMs / 1000} s waiting for the script; it may still be running`,
          ),
        ),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([
      compileGeometryScript({
        code: input.code,
        params: input.params,
        inputs: input.inputs,
        shadowGlobals: true,
        ...(sdfChecksOn() ? { usageShape: true } : {}),
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
