import { z } from 'zod'
import type { AiProviderConfig, AiProviderId } from '../settings/schema'
import { APP_REVIEW_STUB_KEY } from './app-review-demo'
import { aiProvider, DEFAULT_CONTEXT_WINDOW, type AiModelOption } from './provider-catalog'
import { aiApiKeyForConfig } from './secrets'
import { keyProbe, type ApiKeyValidationInput } from './validate-key'

/**
 * The models an API key can call right now, read from the provider's own
 * `/models` endpoint (the one key validation probes) and merged with the
 * curated catalog, so a model launched after this build still reaches the
 * chat picker. The catalog keeps its labels, order and context windows for
 * the models it knows, dropping the ones this key cannot call. Models it
 * doesn't know come first, newest first, limited to chat models at least as
 * new as the catalog's newest: what launched after this build, not every
 * older model still served. When the key lists no catalog model at all (an
 * OpenAI-compatible server, a restricted key) everything it lists is offered.
 *
 * Null means "keep the catalog": OpenRouter (its `~…-latest` aliases already
 * track new models, and it lists hundreds), a CLI (`listCliModels`), the App
 * Review stub key, or a failed call.
 */

/** How long the provider gets to answer before the catalog stands in. */
const LIST_TIMEOUT_MS = 10_000

/** At most this many models the catalog doesn't know join the picker. */
const MAX_ADDED_MODELS = 50

/** One model as the provider lists it, before the catalog merge. */
interface ListedModel {
  id: string
  label?: string | undefined
  contextWindow?: number | undefined
  /**
   * Orders releases, larger is newer: the release time in ms where the
   * provider gives one, the version number for Gemini (which lists no dates).
   */
  release?: number | undefined
}

/** Ids of non-chat models (audio, images, embeddings, tools) and pinned snapshots. */
const OPENAI_NON_CHAT =
  /audio|realtime|tts|transcribe|whisper|diarize|image|search|embedding|moderation|instruct|codex|translate|chat-latest|-\d{4}-\d{2}-\d{2}$|-\d{4}$/u
const GOOGLE_NON_CHAT =
  /preview|exp|tts|image|embedding|live|audio|transcribe|robotics|computer-use|latest|customtools|-\d{3}$/u

const openAiListSchema = z.object({
  data: z.array(z.object({ id: z.string(), created: z.number().optional() })),
})

const anthropicListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.string().optional(),
      created_at: z.string().optional(),
      max_input_tokens: z.number().optional(),
    }),
  ),
})

const googleListSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      displayName: z.string().optional(),
      inputTokenLimit: z.number().optional(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
})

function openAiModels(body: unknown): ListedModel[] {
  return openAiListSchema
    .parse(body)
    .data.filter((model) => /^(?:gpt-|o\d)/u.test(model.id) && !OPENAI_NON_CHAT.test(model.id))
    .map((model) => ({
      id: model.id,
      release: model.created === undefined ? undefined : model.created * 1000,
    }))
}

function anthropicModels(body: unknown): ListedModel[] {
  return anthropicListSchema
    .parse(body)
    .data.filter((model) => model.id.startsWith('claude-') && !/-\d{8}$/u.test(model.id))
    .map((model) => ({
      id: model.id,
      label: model.display_name,
      contextWindow: model.max_input_tokens,
      release: model.created_at === undefined ? undefined : Date.parse(model.created_at),
    }))
}

function googleModels(body: unknown): ListedModel[] {
  return googleListSchema.parse(body).models.flatMap((model) => {
    const id = model.name.replace(/^models\//u, '')
    const version = /^gemini-(\d+(?:\.\d+)?)/u.exec(id)?.[1]
    if (
      version === undefined ||
      GOOGLE_NON_CHAT.test(id) ||
      !(model.supportedGenerationMethods ?? []).includes('generateContent')
    ) {
      return []
    }
    return [
      {
        id,
        label: model.displayName,
        contextWindow: model.inputTokenLimit,
        release: Number(version),
      },
    ]
  })
}

function compatibleModels(body: unknown): ListedModel[] {
  return openAiListSchema.parse(body).data.map((model) => ({ id: model.id }))
}

/** Per provider: its `/models` page-size query and the parser of its answer. */
const LISTS: Partial<
  Record<AiProviderId, { query?: Record<string, string>; parse: (body: unknown) => ListedModel[] }>
> = {
  openai: { parse: openAiModels },
  anthropic: { query: { limit: '1000' }, parse: anthropicModels },
  google: { query: { pageSize: '1000' }, parse: googleModels },
  'openai-compatible': { parse: compatibleModels },
}

/** The catalog merge described at the top of this file. */
function mergeWithCatalog(provider: AiProviderId, listed: readonly ListedModel[]): AiModelOption[] {
  const catalog = aiProvider(provider).models
  const catalogIds = new Set(catalog.map((model) => model.id))
  const listedIds = new Set(listed.map((model) => model.id))
  const releases = listed.flatMap((model) =>
    catalogIds.has(model.id) && model.release !== undefined ? [model.release] : [],
  )
  const cutoff = releases.length === 0 ? null : Math.max(...releases)
  const added = listed
    .filter((model) => !catalogIds.has(model.id))
    .filter((model) => cutoff === null || (model.release ?? 0) >= cutoff)
    .sort((left, right) => (right.release ?? 0) - (left.release ?? 0))
    .slice(0, MAX_ADDED_MODELS)
    .map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    }))
  return [...added, ...catalog.filter((model) => listedIds.has(model.id))]
}

/**
 * The models `input.provider` offers this key, merged with the catalog, or
 * null to keep the catalog. `fetchFn` is the host's CORS-free transport, as
 * for `validateApiKey`. Never throws: a failed list is just "no list".
 */
export async function listHostedModels(
  input: ApiKeyValidationInput,
  fetchFn: typeof fetch = fetch,
): Promise<AiModelOption[] | null> {
  const list = LISTS[input.provider]
  const probe = keyProbe(input)
  if (list === undefined || probe === null || input.apiKey === APP_REVIEW_STUB_KEY) {
    return null
  }
  const url = new URL(probe.url)
  for (const [name, value] of Object.entries(list.query ?? {})) {
    url.searchParams.set(name, value)
  }
  try {
    const response = await fetchFn(url.href, {
      method: 'GET',
      headers: probe.headers(input.apiKey),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    if (!response.ok) {
      return null
    }
    const merged = mergeWithCatalog(input.provider, list.parse(await response.json()))
    return merged.length === 0 ? null : merged
  } catch {
    return null
  }
}

/** {@link listHostedModels} for a configured entry, reading its keychain key. */
export async function listConfiguredModels(
  config: AiProviderConfig,
  fetchFn: typeof fetch = fetch,
): Promise<AiModelOption[] | null> {
  const apiKey = await aiApiKeyForConfig(config).catch(() => null)
  if (apiKey === null) {
    return null
  }
  return await listHostedModels(
    {
      provider: config.provider,
      apiKey,
      baseUrl: 'baseUrl' in config ? config.baseUrl : undefined,
    },
    fetchFn,
  )
}
