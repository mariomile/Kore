import type { LanguageModel } from 'ai'
import type { AiProviderConfig } from '../settings/schema'
import { anthropicDirectBrowserAccessHeaders } from './anthropic-headers'
import { APP_REVIEW_STUB_KEY, createDemoModel } from './app-review-demo'
import { OPENAI_COMPATIBLE_PROVIDER_ID } from './openai-compatible'
import { OPENROUTER_BASE_URL, openRouterAttributionHeaders } from './openrouter'

/**
 * Build the AI SDK model instance for a configured BYOK entry — the one place
 * provider ids map to SDK factories. Shared by the chat engine
 * (`chat/stream-chat`) and one-shot calls like the link-capture page
 * description (`describe-page`).
 *
 * Async because each provider package loads on first use (see `load-sdk`):
 * only the configured provider's code is ever fetched.
 */
export async function languageModel(
  config: AiProviderConfig,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<LanguageModel> {
  // App Review demo mode: a local model regardless of the configured
  // provider, since the reviewer may have picked any of them.
  if (apiKey === APP_REVIEW_STUB_KEY) {
    return createDemoModel()
  }
  switch (config.provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey, fetch: fetchFn })(config.model)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({
        apiKey,
        fetch: fetchFn,
        headers: anthropicDirectBrowserAccessHeaders(),
      })(config.model)
    }
    case 'google': {
      const { createGoogle } = await import('@ai-sdk/google')
      return createGoogle({ apiKey, fetch: fetchFn })(config.model)
    }
    case 'openrouter': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({
        apiKey,
        fetch: fetchFn,
        baseURL: OPENROUTER_BASE_URL,
        headers: openRouterAttributionHeaders(),
        name: 'openrouter',
      }).chat(config.model)
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      return createOpenAICompatible({
        name: OPENAI_COMPATIBLE_PROVIDER_ID,
        baseURL: config.baseUrl,
        fetch: fetchFn,
        includeUsage: true,
        ...(apiKey.trim() === '' ? {} : { apiKey }),
      }).chatModel(config.model)
    }
    case 'claude-cli':
    case 'codex-cli':
    case 'cursor-cli':
      // The CLI providers stream through their own engines (`ai/claude-cli`,
      // `ai/codex-cli`, `ai/cursor-cli`), never through the AI SDK — reaching here means a
      // feature that needs a direct provider call was pointed at a
      // subscription entry.
      throw new Error(
        'Subscription providers support chat only — pick an API-key provider for this feature.',
      )
  }
}
