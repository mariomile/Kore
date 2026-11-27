import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  errorMessage,
  hiddenNoteFieldKeys,
  readVaultSettings,
  withNoteFieldHidden,
  writeVaultSettings,
} from '@kore/core'
import { toast } from '@/components/ui/toast'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useGraph } from '@/providers/graph-provider'

export interface HiddenNoteFields {
  /** Keys the vault hides from every note's properties panel. */
  hidden: ReadonlySet<string>
  /** Hide `key` from every note, or show it again. */
  setHidden: (key: string, hidden: boolean) => void
}

const EMPTY: ReadonlySet<string> = new Set()

/** Writes queue up, so two quick toggles land in the order they were made. */
let writes: Promise<void> = Promise.resolve()

/**
 * The fields the open vault hides from note panels (`properties.hiddenInNote`
 * in its `.kore.json`, see `hiddenNoteFieldKeys`). A toggle shows at once,
 * then writes against the file's current contents so another device's
 * unrelated change survives; a failed write says so and puts the list back.
 * An unreadable file hides nothing: every field stays one tap away.
 */
export function useHiddenNoteFields(): HiddenNoteFields {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['vault-settings', graph?.root, 'hidden-note-fields'], [graph])

  const { data } = useQuery({
    queryKey,
    queryFn: async () => hiddenNoteFieldKeys(await readVaultSettings(graph?.generation ?? 0)),
    enabled: bridgeReady && graph !== null,
    staleTime: Infinity,
    // An unreadable file hides nothing (no data); retrying won't fix a bad
    // hand edit, and the next vault open reads it again.
    retry: false,
  })
  const hidden = useMemo(() => (data === undefined ? EMPTY : new Set(data)), [data])

  const setHidden = useCallback(
    (key: string, next: boolean): void => {
      if (graph === null) {
        return
      }
      const previous = queryClient.getQueryData<string[]>(queryKey) ?? []
      const shown = hiddenNoteFieldKeys(
        withNoteFieldHidden({ properties: { hiddenInNote: previous } }, key, next),
      )
      queryClient.setQueryData(queryKey, shown)
      writes = writes.then(async () => {
        try {
          const vault = await readVaultSettings(graph.generation)
          await writeVaultSettings(withNoteFieldHidden(vault, key, next), graph.generation)
        } catch (cause) {
          if (queryClient.getQueryData(queryKey) === shown) {
            queryClient.setQueryData(queryKey, previous)
          }
          toast.add({
            type: 'error',
            title: next ? "Couldn't hide the property" : "Couldn't show the property",
            description: errorMessage(cause),
          })
        }
      })
    },
    [graph, queryClient, queryKey],
  )

  return { hidden, setHidden }
}
