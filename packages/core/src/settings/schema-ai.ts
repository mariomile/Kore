import { z } from 'zod'
import { isHttpBaseUrl, normalizeOpenAICompatibleBaseUrl } from '../ai/openai-compatible'

/**
 * The AI providers Reflect can call directly (BYOK — the user's own keys, no
 * Reflect-hosted proxy). `openai-compatible` stores its user-supplied base URL
 * per configured entry.
 */
export const aiProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'openai-compatible',
  'claude-cli',
  'codex-cli',
  'cursor-cli',
])

export type AiProviderId = z.infer<typeof aiProviderIdSchema>

const hostedAiProviderIdSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter'])

export type HostedAiProviderId = z.infer<typeof hostedAiProviderIdSchema>

export const openAiCompatibleBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isHttpBaseUrl)
  .transform(normalizeOpenAICompatibleBaseUrl)

/**
 * One configured AI provider: the provider, its default model id, and a key
 * hint. The API key itself lives in the OS keychain (addressed by `id` — see
 * `aiKeySecretName`) and **never** in this document; `keyHint` keeps only the
 * key's trailing characters so the settings UI can identify it. Which entry
 * is the app-wide default is a sibling scalar (`defaultAiProviderId`), not a
 * per-entry flag, so "at most one default" holds by construction.
 * OpenAI-compatible entries additionally carry their API base URL, because it
 * is user configuration rather than a fixed catalog endpoint.
 */
const aiProviderConfigBaseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  keyHint: z.string().catch(''),
})

const openAiProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('openai'),
})

const anthropicProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('anthropic'),
})

const googleProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('google'),
})

const openRouterProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('openrouter'),
})

const hostedAiProviderConfigSchema = z.union([
  openAiProviderConfigSchema,
  anthropicProviderConfigSchema,
  googleProviderConfigSchema,
  openRouterProviderConfigSchema,
])

export type HostedAiProviderConfig = z.infer<typeof hostedAiProviderConfigSchema>

const openAiCompatibleProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('openai-compatible'),
  baseUrl: openAiCompatibleBaseUrlSchema,
})

export type OpenAiCompatibleProviderConfig = z.infer<typeof openAiCompatibleProviderConfigSchema>

/**
 * The Claude Code CLI provider ("subscription" AI): no API key — the locally
 * installed `claude` binary carries its own Claude sign-in, so chat bills
 * the user's subscription. Desktop-only (the CLI can't run on iOS).
 */
const claudeCliProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('claude-cli'),
})

export type ClaudeCliProviderConfig = z.infer<typeof claudeCliProviderConfigSchema>

/**
 * The Codex CLI provider: same contract as the Claude Code entry — no API
 * key, the locally installed `codex` binary carries its own ChatGPT sign-in,
 * so chat bills the user's subscription. Desktop-only.
 */
const codexCliProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('codex-cli'),
})

export type CodexCliProviderConfig = z.infer<typeof codexCliProviderConfigSchema>

/**
 * The Cursor CLI provider: same contract — no API key, the locally
 * installed `cursor-agent` binary carries its own Cursor sign-in, so chat
 * bills the user's subscription. Desktop-only, and read-only: the engine
 * never joins edit mode (see `cliProviderSupportsEdits`).
 */
const cursorCliProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('cursor-cli'),
})

export type CursorCliProviderConfig = z.infer<typeof cursorCliProviderConfigSchema>

export const aiProviderConfigSchema = z.discriminatedUnion('provider', [
  openAiProviderConfigSchema,
  anthropicProviderConfigSchema,
  googleProviderConfigSchema,
  openRouterProviderConfigSchema,
  openAiCompatibleProviderConfigSchema,
  claudeCliProviderConfigSchema,
  codexCliProviderConfigSchema,
  cursorCliProviderConfigSchema,
])

export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>

/**
 * The `aiProviders` entry AI features use by default. A dangling or null id
 * is legal (hand-edits, removed entries) — readers resolve it through
 * `defaultAiProvider`, which falls back to the first entry.
 */
export const defaultAiProviderIdSchema = z.string().nullable().catch(null)

/**
 * The model the chat last used: a configured `aiProviders` entry (`configId`)
 * plus a model id within it. Persisted so the next chat session starts on
 * whatever the user picked last; null (the default) means the app default
 * entry and its configured model. A dangling reference is legal (the entry
 * may have been removed since) — readers resolve it through
 * `resolveChatModel`, which falls back to the default entry — and an invalid
 * value degrades to null.
 */
export const chatModelSelectionSchema = z
  .object({
    configId: z.string().min(1),
    modelId: z.string().min(1),
  })
  .nullable()
  .catch(null)

/** A chat model choice — a configured provider entry + a model within it. */
export type ChatModelSelection = NonNullable<z.infer<typeof chatModelSelectionSchema>>

/** Maximum user-configured system prompt size (~5,000 prose tokens). */
export const CHAT_SYSTEM_PROMPT_MAX_LENGTH = 20_000

/** Canonicalize a user-configured chat prompt before storing or sending it. */
export function normalizeChatSystemPrompt(value: string): string {
  return value.trim().slice(0, CHAT_SYSTEM_PROMPT_MAX_LENGTH)
}

/**
 * Additional instructions the user wants included in every AI chat system
 * prompt. Reflect's built-in grounding and privacy rules remain in place;
 * this text is appended after them so users can configure tone, format, and
 * other assistant behavior. Empty (the default) adds nothing. Oversized
 * hand-edited values are truncated so the prompt cannot consume the model's
 * context window on its own.
 */
export const chatSystemPromptSchema = z.string().catch('').transform(normalizeChatSystemPrompt)

/**
 * Chat edit mode: whether agent-CLI chat may create and modify notes (the
 * BYOK engines stay read-only regardless). Off by default — writing is a
 * capability the user turns on deliberately, per graph settings document.
 */
export const chatAllowEditsSchema = z.boolean().catch(false)

/** The active agent profile's slug (`agents/<slug>/`), or null for none. */
export const activeAgentProfileSchema = z.string().nullable().catch(null)

/**
 * Memory write approval: when on, agents stage writes to the user profile
 * and shared facts as pending proposals instead of editing them directly.
 */
export const memoryWriteApprovalSchema = z.boolean().catch(false)

// Scheduled agent routines (automations) live in `ai/agent-routines.ts`;
// the settings document stores them so the Agents screen and the background
// runner share one source of truth.

/**
 * The configured AI providers. Resilience is per entry, not per list: a
 * corrupt entry is dropped while the rest load, so one bad hand-edit can't
 * wipe every configured provider. A non-array value degrades to the empty
 * list.
 */
export const aiProvidersSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = aiProviderConfigSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

/**
 * Where an AI selection prompt's accepted result lands: `replace` swaps the
 * selection for the result; `append` inserts the result after the selection's
 * block (e.g. "Continue writing"). An invalid value degrades to `replace`.
 */
export const aiPromptModeSchema = z.enum(['replace', 'append']).catch('replace')

export type AiPromptMode = z.infer<typeof aiPromptModeSchema>

/**
 * One saved AI selection prompt: a label for the picker and a body sent to
 * the provider. The body may reference the selection with the
 * `{{selectedText}}` placeholder (old Reflect's syntax, so saved v1 prompts
 * port over verbatim); a body without the placeholder gets the selection
 * appended after it.
 */
export const aiPromptSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  body: z.string().min(1),
  mode: aiPromptModeSchema,
})

export type AiPrompt = z.infer<typeof aiPromptSchema>

/**
 * The user's saved AI selection prompts, shown in the editor's AI menu after
 * the built-in set. Global across graphs — prompts are workflow, not note
 * content. Resilience is per entry: a corrupt entry is dropped while the rest
 * load, and a non-array value degrades to the empty list.
 */
export const aiPromptsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = aiPromptSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

/**
 * Whether audio-memo transcripts receive a best-effort AI formatting pass
 * before they are written as Markdown. On by default, matching the original
 * Reflect preference. Turning it off keeps the transcription provider's raw
 * body; transcript-derived title generation remains enabled.
 */
export const transcriptionFormatSchema = z.boolean().catch(true)

/**
 * Per-provider transcription model override for audio memos. An empty string
 * means "the app's built-in default for that provider" (see
 * `ai/transcribe`), so a fresh install carries no opinion and a provider
 * whose default model is retired can be repointed without a release.
 *
 * The keys mirror `TRANSCRIPTION_PROVIDERS`; they are spelled out here
 * because the provider module reads this schema and cannot be imported back.
 * Speech-to-text and chat models are separate choices — a chat model cannot
 * take the transcription endpoint — so this never falls back to the entry's
 * default model.
 */
export const transcriptionModelsSchema = z
  .object({
    openai: z
      .string()
      .catch('')
      .transform((model) => model.trim()),
    google: z
      .string()
      .catch('')
      .transform((model) => model.trim()),
  })
  .catch({ openai: '', google: '' })

export type TranscriptionModels = z.infer<typeof transcriptionModelsSchema>
