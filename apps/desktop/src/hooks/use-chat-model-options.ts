import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  chatModelOptions,
  isCliAgentProvider,
  listCliModels,
  listConfiguredModels,
  type AiModelOption,
  type AiProviderConfig,
  type ChatModelOption,
  type LiveModelLists,
} from '@kore/core'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'
import { providerFetch } from '@/lib/provider-fetch'

/** Query scope of the CLIs' model lists; a sign-in change invalidates it. */
export const CLI_MODELS_QUERY_SCOPE = 'cli-models'

/** Query scope of the API keys' model lists (`/models`). */
export const HOSTED_MODELS_QUERY_SCOPE = 'hosted-models'

/** A model list changes with launches and plans, not by the minute. */
const MODEL_LIST_STALE_MS = 60 * 60_000

/** The live-list query for one configured entry. */
function modelListQuery(entry: AiProviderConfig) {
  if (isCliAgentProvider(entry.provider)) {
    const id = entry.provider
    return {
      queryKey: [CLI_MODELS_QUERY_SCOPE, id],
      queryFn: async () => await listCliModels(id),
      // The CLIs exist only where the native shell spawns them.
      enabled: isNativeShell() && !isMobileSurface(),
    }
  }
  return {
    // The key hint and base URL are in the key, so a changed key or endpoint
    // reads a fresh list.
    queryKey: [
      HOSTED_MODELS_QUERY_SCOPE,
      entry.id,
      entry.provider,
      entry.keyHint,
      'baseUrl' in entry ? entry.baseUrl : null,
    ],
    queryFn: async () => await listConfiguredModels(entry, providerFetch),
    // Plain-browser dev has no keychain and no CORS-free transport.
    enabled: isNativeShell(),
  }
}

/**
 * The chat model picker's options, each configured entry offering the models
 * it can call right now: a subscription CLI's own list (`listCliModels`), or
 * the provider's `/models` merged with the catalog (`listConfiguredModels`).
 * Until a list arrives, or when it can't be read, the catalog stands in, so
 * the picker never waits on a process spawn or a network call.
 */
export function useChatModelOptions(providers: AiProviderConfig[]): ChatModelOption[] {
  const combine = useCallback(
    (results: { data?: AiModelOption[] | null | undefined }[]): LiveModelLists =>
      Object.fromEntries(
        providers.flatMap((entry, index) => {
          const models = results[index]?.data
          return models == null || models.length === 0 ? [] : [[entry.id, models]]
        }),
      ),
    [providers],
  )
  const liveModels = useQueries({
    queries: providers.map((entry) => ({
      ...modelListQuery(entry),
      staleTime: MODEL_LIST_STALE_MS,
      retry: false,
    })),
    combine,
  })
  return useMemo(() => chatModelOptions(providers, liveModels), [providers, liveModels])
}
