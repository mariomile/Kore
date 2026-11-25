import type { AnthropicProvider } from '@ai-sdk/anthropic'
import type { GoogleProvider } from '@ai-sdk/google'
import type { OpenAIProvider } from '@ai-sdk/openai'
import type { AiProviderId } from '../settings/schema'

import { DEFAULT_OPENAI_COMPATIBLE_MODEL } from './openai-compatible'

/** A compile-time guarantee that an array has at least one element. */
type NonEmptyArray<ElementType> = [ElementType, ...ElementType[]]

/**
 * The static BYOK provider catalog (Plan 10): display names, key hints, and
 * the curated model list the settings UI offers per provider. This is policy
 * data, not configuration — the user's chosen entries live in settings as
 * `AiProviderConfig` values.
 */

/** One selectable model in a provider's curated list. */
export interface AiModelOption<Id extends string = string> {
  /** The provider's model identifier, sent verbatim on API calls. */
  id: Id
  /** Human-readable name shown in pickers. */
  label: string
  /**
   * The model's context window in tokens — a deliberate floor, not a spec
   * sheet: the chat engine only needs a budget that never exceeds the real
   * window (`ai/chat/context-window`), so undershooting is safe and exact
   * vendor numbers don't matter.
   */
  contextWindow: number
}

/** One supported BYOK provider. */
export interface AiProviderInfo {
  id: AiProviderId
  /** Human-readable provider name shown in pickers. */
  label: string
  /** Whether a non-empty key must be stored before this provider can be used. */
  apiKeyRequired: boolean
  /** Placeholder illustrating the provider's API-key format. */
  keyPlaceholder: string
  /** Curated models, most capable first (the first is the picker default). */
  models: NonEmptyArray<AiModelOption>
  /**
   * The provider only works on desktop (a local binary is involved) —
   * mobile pickers hide it. Absent means available everywhere.
   */
  desktopOnly?: boolean
}

/** Drop the `(string & {})` escape hatch, leaving only the known literals. */
type KnownId<T> = T extends string ? (string extends T ? never : T) : never

type AnthropicModelId = KnownId<Parameters<AnthropicProvider>[0]>
type GoogleModelId = KnownId<Parameters<GoogleProvider>[0]>
type OpenAIModelId = KnownId<Parameters<OpenAIProvider>[0]>

// Model ids are checked against each SDK's model-id union (the type below
// rejects a typo). Newer models than these still reach the pickers: the live
// `/models` merge (`hosted-models.ts`) adds what a key can call.
const OPENAI_MODELS: NonEmptyArray<AiModelOption<OpenAIModelId>> = [
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', contextWindow: 1_000_000 },
  { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', contextWindow: 1_000_000 },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', contextWindow: 1_000_000 },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', contextWindow: 1_000_000 },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', contextWindow: 1_000_000 },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', contextWindow: 1_000_000 },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', contextWindow: 1_000_000 },
]

const ANTHROPIC_MODELS: NonEmptyArray<AiModelOption<AnthropicModelId>> = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', contextWindow: 1_000_000 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', contextWindow: 1_000_000 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextWindow: 1_000_000 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', contextWindow: 1_000_000 },
  { id: 'claude-fable-5', label: 'Claude Fable 5', contextWindow: 1_000_000 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', contextWindow: 1_000_000 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', contextWindow: 1_000_000 },
]

const GOOGLE_MODELS: NonEmptyArray<AiModelOption<GoogleModelId>> = [
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', contextWindow: 1_000_000 },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', contextWindow: 1_000_000 },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', contextWindow: 1_000_000 },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon', contextWindow: 1_000_000 },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', contextWindow: 1_000_000 },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', contextWindow: 1_000_000 },
]

export const AI_PROVIDERS: NonEmptyArray<AiProviderInfo> = [
  {
    id: 'openai',
    label: 'OpenAI',
    apiKeyRequired: true,
    keyPlaceholder: 'sk-…',
    models: OPENAI_MODELS,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    apiKeyRequired: true,
    keyPlaceholder: 'sk-ant-…',
    models: ANTHROPIC_MODELS,
  },
  {
    id: 'google',
    label: 'Google Gemini',
    apiKeyRequired: true,
    keyPlaceholder: 'AIza…',
    models: GOOGLE_MODELS,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    apiKeyRequired: true,
    keyPlaceholder: 'sk-or-v1-…',
    models: [
      { id: 'openrouter/auto', label: 'Auto Router', contextWindow: 2_000_000 },
      { id: '~openai/gpt-latest', label: 'OpenAI GPT Latest', contextWindow: 1_000_000 },
      {
        id: '~anthropic/claude-sonnet-latest',
        label: 'Claude Sonnet Latest',
        contextWindow: 1_000_000,
      },
      { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', contextWindow: 1_000_000 },
    ],
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    apiKeyRequired: false,
    keyPlaceholder: 'Optional API key',
    models: [{ id: DEFAULT_OPENAI_COMPATIBLE_MODEL, label: 'Local model', contextWindow: 128_000 }],
  },
  {
    // The Claude Code CLI ("subscription" AI): no key — the installed
    // `claude` binary carries its own Claude sign-in. Model ids are the
    // CLI's aliases, resolved by the CLI itself; `default` sends no
    // `--model` at all. Context windows are conservative floors — the CLI
    // manages its own context, this only budgets the transcript we send.
    id: 'claude-cli',
    label: 'Claude Code (subscription)',
    apiKeyRequired: false,
    keyPlaceholder: 'No API key — uses your Claude sign-in',
    desktopOnly: true,
    models: [
      { id: 'default', label: 'CLI default', contextWindow: 200_000 },
      { id: 'opus', label: 'Claude Opus', contextWindow: 200_000 },
      { id: 'sonnet', label: 'Claude Sonnet', contextWindow: 200_000 },
      { id: 'haiku', label: 'Claude Haiku', contextWindow: 200_000 },
    ],
  },
  {
    // The Codex CLI ("subscription" AI): no key — the installed `codex`
    // binary carries its own ChatGPT sign-in. Model ids are the CLI's model
    // slugs; `default` sends no model flag at all. Context windows are
    // conservative floors for the transcript budget only.
    id: 'codex-cli',
    label: 'Codex (subscription)',
    apiKeyRequired: false,
    keyPlaceholder: 'No API key — uses your ChatGPT sign-in',
    desktopOnly: true,
    models: [
      { id: 'default', label: 'CLI default', contextWindow: 200_000 },
      { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', contextWindow: 200_000 },
      { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', contextWindow: 200_000 },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', contextWindow: 200_000 },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', contextWindow: 200_000 },
    ],
  },
  {
    // The Cursor CLI ("subscription" AI): no key — the installed
    // `cursor-agent` binary carries its own Cursor sign-in. `default` sends
    // no model flag; `auto` is Cursor's own model router. Context windows
    // are conservative floors for the transcript budget only.
    id: 'cursor-cli',
    label: 'Cursor (subscription)',
    apiKeyRequired: false,
    keyPlaceholder: 'No API key — uses your Cursor sign-in',
    desktopOnly: true,
    models: [
      { id: 'default', label: 'CLI default', contextWindow: 200_000 },
      { id: 'auto', label: 'Auto (Cursor picks)', contextWindow: 200_000 },
    ],
  },
]

/** The catalog entry for `id` (every `AiProviderId` is in the catalog). */
export function aiProvider(id: AiProviderId): AiProviderInfo {
  const provider = AI_PROVIDERS.find((candidate) => candidate.id === id)
  if (!provider) {
    throw new Error(`unknown AI provider: ${id}`)
  }
  return provider
}

/** Whether a configured provider must have a non-empty keychain secret. */
export function aiProviderRequiresApiKey(id: AiProviderId): boolean {
  return aiProvider(id).apiKeyRequired
}

/**
 * Display name for a model, falling back to the raw id for models outside the
 * curated list (a settings document may carry ids added by a newer version).
 */
export function aiModelLabel(provider: AiProviderId, modelId: string): string {
  const match = aiProvider(provider).models.find((model) => model.id === modelId)
  return match?.label ?? modelId
}

/**
 * Floor for models outside the curated list (a settings document may carry
 * ids added by a newer version): small enough to be safe on any model worth
 * configuring, large enough not to cripple the history.
 */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/**
 * Context window (in tokens) for a model, falling back to
 * {@link DEFAULT_CONTEXT_WINDOW} for ids outside the curated list.
 */
export function modelContextWindow(provider: AiProviderId, modelId: string): number {
  const match = aiProvider(provider).models.find((model) => model.id === modelId)
  return match?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}
