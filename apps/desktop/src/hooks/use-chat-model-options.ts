import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  chatModelOptions,
  isCliAgentProvider,
  listCliModels,
  type AiModelOption,
  type AiProviderConfig,
  type ChatModelOption,
  type CliAgentProviderId,
  type LiveModelLists,
} from '@kore/core'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'

/** Query scope of the CLIs' model lists; a sign-in change invalidates it. */
export const CLI_MODELS_QUERY_SCOPE = 'cli-models'

/** A CLI's list changes with launches and plans, not by the minute. */
const CLI_MODELS_STALE_MS = 60 * 60_000

/**
 * The chat model picker's options, with each configured subscription CLI
 * offering the models it reports itself (`listCliModels`) instead of the
 * static catalog. Until a list arrives, or when the CLI can't answer, the
 * catalog stands in, so the picker never waits on a process spawn.
 */
export function useChatModelOptions(providers: AiProviderConfig[]): ChatModelOption[] {
  const cliIds = useMemo(
    () => [
      ...new Set(
        providers
          .map((entry) => entry.provider)
          .filter((id): id is CliAgentProviderId => isCliAgentProvider(id)),
      ),
    ],
    [providers],
  )
  const combine = useCallback(
    (results: { data?: AiModelOption[] | null | undefined }[]): LiveModelLists =>
      Object.fromEntries(
        cliIds.flatMap((id, index) => {
          const models = results[index]?.data
          return models == null || models.length === 0 ? [] : [[id, models]]
        }),
      ),
    [cliIds],
  )
  const liveModels = useQueries({
    queries: cliIds.map((id) => ({
      queryKey: [CLI_MODELS_QUERY_SCOPE, id],
      queryFn: async () => await listCliModels(id),
      // The CLIs exist only where the native shell spawns them.
      enabled: isNativeShell() && !isMobileSurface(),
      staleTime: CLI_MODELS_STALE_MS,
      retry: false,
    })),
    combine,
  })
  return useMemo(() => chatModelOptions(providers, liveModels), [providers, liveModels])
}
