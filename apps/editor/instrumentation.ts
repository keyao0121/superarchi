export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { applyAcdeServerEnv } = await import('./lib/acde/server-env')
  applyAcdeServerEnv(process.env)
}
