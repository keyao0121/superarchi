import { z } from 'zod'
import { modelSettingsView, readModelSettings, writeModelSettings } from '@/lib/agent/settings'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The key is optional on an update: a page never holds the stored one to send it back. */
const putSettingsSchema = z.object({
  baseUrl: z.string().url().max(500),
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(500).optional(),
})

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  return sceneApiJson(request, modelSettingsView(await readModelSettings()))
}

export async function PUT(request: Request) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const parsed = putSettingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_settings' }, { status: 400 })
  }
  const apiKey = parsed.data.apiKey ?? (await readModelSettings())?.apiKey
  if (!apiKey) {
    return sceneApiJson(request, { error: 'api_key_required' }, { status: 400 })
  }
  const settings = { baseUrl: parsed.data.baseUrl, model: parsed.data.model, apiKey }
  await writeModelSettings(settings)
  return sceneApiJson(request, modelSettingsView(settings))
}
