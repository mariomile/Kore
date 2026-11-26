import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  baseDatabase,
  createBaseVault,
  listBaseFiles,
  loadBaseRows,
  parseBaseFile,
  readBaseFile,
  runBaseView,
  type BaseDatabase,
  type BaseDefinition,
  type BaseVault,
  type BaseViewResult,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Every note, shaped for bases; shared by every base view on screen. */
export function useBaseVault(): {
  vault: BaseVault | undefined
  loadedAt: number
  failed: boolean
} {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'base-rows'],
    queryFn: async () => createBaseVault(await loadBaseRows()),
    enabled: bridgeReady && graph !== null,
    placeholderData: keepPreviousData,
  })
  return { vault: data, loadedAt: dataUpdatedAt, failed: isError }
}

/** The `.base` files in the vault, sorted by path. */
export function useBaseFiles(): { paths: readonly string[] | undefined; failed: boolean } {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'base-files'],
    queryFn: () => listBaseFiles(graph?.generation),
    enabled: bridgeReady && graph !== null,
  })
  return { paths: data, failed: isError }
}

/** The query key of one `.base` file's parsed definition. */
export function baseDefinitionQueryKey(root: string | undefined, path: string | null) {
  return [INDEX_QUERY_SCOPE, root, 'base-file', path] as const
}

export function useBaseDefinition(path: string | null): {
  definition: BaseDefinition | undefined
  error: string | null
} {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, error } = useQuery({
    queryKey: baseDefinitionQueryKey(graph?.root, path),
    queryFn: async () => {
      if (path === null || graph === null) {
        throw new Error('No base to read.')
      }
      return parseBaseFile(await readBaseFile(path, graph.generation))
    },
    enabled: bridgeReady && graph !== null && path !== null,
    retry: false,
  })
  return { definition: data, error: error === null ? null : error.message }
}

/** The index of the view named `view`; the first view when null or unknown. */
function viewIndexOf(definition: BaseDefinition, view: string | null): number {
  return Math.max(
    0,
    view === null ? -1 : definition.views.findIndex((entry) => entry.name === view),
  )
}

export type BaseViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      definition: BaseDefinition
      viewIndex: number
      result: BaseViewResult
    }

/**
 * Load `path` and run the view named `view` (the first view when null or
 * unknown) over the vault. Re-runs when the index changes.
 */
export function useBaseView(path: string | null, view: string | null): BaseViewState {
  const { definition, error } = useBaseDefinition(path)
  // `now()` in formulas is the time the notes were read, so a view is a
  // stable snapshot that moves forward whenever the index refreshes it.
  const { vault, loadedAt, failed } = useBaseVault()
  return useMemo((): BaseViewState => {
    if (error !== null) {
      return { status: 'error', message: error }
    }
    if (failed) {
      return { status: 'error', message: 'Couldn’t read the notes for this base.' }
    }
    if (definition === undefined || vault === undefined) {
      return { status: 'loading' }
    }
    const viewIndex = viewIndexOf(definition, view)
    return {
      status: 'ready',
      definition,
      viewIndex,
      result: runBaseView(definition, viewIndex, vault, loadedAt),
    }
  }, [definition, error, vault, loadedAt, failed, view])
}

export type BaseDatabaseState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; definition: BaseDefinition; database: BaseDatabase }

/**
 * Load `path` as a database showing the view named `view` (the first view
 * when null or unknown): the type page's shape over the base's notes.
 */
export function useBaseDatabase(path: string | null, view: string | null): BaseDatabaseState {
  const { definition, error } = useBaseDefinition(path)
  const { vault, loadedAt, failed } = useBaseVault()
  return useMemo((): BaseDatabaseState => {
    if (error !== null) {
      return { status: 'error', message: error }
    }
    if (failed) {
      return { status: 'error', message: 'Couldn’t read the notes for this base.' }
    }
    if (definition === undefined || vault === undefined) {
      return { status: 'loading' }
    }
    return {
      status: 'ready',
      definition,
      database: baseDatabase(definition, viewIndexOf(definition, view), vault, loadedAt),
    }
  }, [definition, error, vault, loadedAt, failed, view])
}
