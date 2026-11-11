import { useQuery } from '@tanstack/react-query'
import {
  libraryList,
  libraryRead,
  libraryRoots,
  type LibraryDir,
  type LibraryRoot,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'

/**
 * The Library's folders live outside the graph, so no watcher or index
 * invalidation keeps them fresh. Agents rewrite them while Kore sits in the
 * background, so these reads refetch whenever the window comes back.
 */
const LIBRARY_QUERY_SCOPE = 'library'
const FRESH_ON_RETURN = { staleTime: 0, refetchOnWindowFocus: true } as const

/** The agent folders on this machine; empty until loaded or when there are none. */
export function useLibraryRoots(): LibraryRoot[] {
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [LIBRARY_QUERY_SCOPE, 'roots'],
    queryFn: () => libraryRoots(),
    enabled: bridgeReady,
    ...FRESH_ON_RETURN,
  })
  return data ?? []
}

/**
 * One level of a library folder, loaded when `enabled` (the row is expanded):
 * the listing, `'error'` when the folder could not be opened (permissions, or
 * it was deleted), or null while loading.
 */
export function useLibraryDir(
  root: string,
  dir: string,
  enabled: boolean,
): LibraryDir | 'error' | null {
  const bridgeReady = useBridgeReady()
  const { data, isError } = useQuery({
    queryKey: [LIBRARY_QUERY_SCOPE, 'dir', root, dir],
    queryFn: () => libraryList(root, dir),
    enabled: bridgeReady && enabled,
    ...FRESH_ON_RETURN,
  })
  return isError ? 'error' : (data ?? null)
}

/** One Library file's text, with its loading and error states. */
export function useLibraryFile(root: string, path: string) {
  const bridgeReady = useBridgeReady()
  return useQuery({
    queryKey: [LIBRARY_QUERY_SCOPE, 'file', root, path],
    queryFn: () => libraryRead(root, path),
    enabled: bridgeReady,
    ...FRESH_ON_RETURN,
  })
}
