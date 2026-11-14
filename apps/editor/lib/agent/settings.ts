import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDefaultDatabasePath } from '@pascal-app/mcp/storage'
import { z } from 'zod'
import type { AgentModelSettingsView } from './types'

/** An OpenAI-compatible chat completions endpoint: `<baseUrl>/chat/completions`. */
export const modelSettingsSchema = z.object({
  baseUrl: z.string().url().max(500),
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(500),
})
export type AgentModelSettings = z.infer<typeof modelSettingsSchema>

/** Beside the scene database, so the key stays in the app's private data and out of the project. */
export function modelSettingsPath(): string {
  return join(dirname(resolveDefaultDatabasePath()), 'agent-model.json')
}

export async function readModelSettings(
  path = modelSettingsPath(),
): Promise<AgentModelSettings | null> {
  try {
    const parsed = modelSettingsSchema.safeParse(
      JSON.parse(await readFile(/* turbopackIgnore: true */ path, 'utf8')),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function writeModelSettings(
  settings: AgentModelSettings,
  path = modelSettingsPath(),
): Promise<void> {
  await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true })
  const partial = `${path}.partial`
  await writeFile(/* turbopackIgnore: true */ partial, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(/* turbopackIgnore: true */ partial, 0o600)
  await rename(/* turbopackIgnore: true */ partial, /* turbopackIgnore: true */ path)
}

/** What a page may read: never the key itself. */
export function modelSettingsView(settings: AgentModelSettings | null): AgentModelSettingsView {
  return {
    baseUrl: settings?.baseUrl ?? '',
    model: settings?.model ?? '',
    hasApiKey: Boolean(settings?.apiKey),
  }
}
