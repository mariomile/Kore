import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { folderTreeAffectedBy, type FileChange, type FolderTreeFolder } from '@kore/core'

/**
 * The app's one TanStack Query client (adopted in Plan 07 per architecture
 * conventions §5): `queryFn`s are `@kore/core` getters over the SQLite
 * projection, so freshness is event-driven, not poll-driven — the graph index
 * lifecycle calls {@link invalidateIndexQueries} after rows actually change
 * (initial reconcile, then each applied watcher batch).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Index reads are local SQLite over IPC: cheap, and kept fresh by
      // invalidation. Treat cached data as good until an invalidation says
      // otherwise; never refetch just because a window regained focus.
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

/** Every index-backed query nests under this key (e.g. `['index', 'backlinks', path]`). */
export const INDEX_QUERY_SCOPE = 'index'

/** Refetch all index-backed queries; called after index rows change. */
export function invalidateIndexQueries(): void {
  void queryClient.invalidateQueries({ queryKey: [INDEX_QUERY_SCOPE] })
}

/**
 * Minimum spacing between full index-query refetch rounds on the batch
 * paths. During an initial iCloud sync the watch applies a batch every
 * couple of seconds for minutes; refetching every mounted index query per
 * batch is a large share of what makes a first sync feel slow.
 */
export const INVALIDATE_THROTTLE_MS = 3_000

let lastInvalidateAt = 0
let invalidateTimer: ReturnType<typeof setTimeout> | null = null
/** What the next throttled round covers: the batches since the last one, or everything. */
let pendingChanges: FileChange[] | 'all' = []

/** Most changes one throttled round narrows by before it refreshes everything. */
const NARROW_INVALIDATION_LIMIT = 256

/** Key segment of the vault folder tree query (`useFolderTree`). */
export const FOLDER_TREE_QUERY = 'folder-tree'

function isFolderTreeKey(key: QueryKey): boolean {
  return key[0] === INDEX_QUERY_SCOPE && key[2] === FOLDER_TREE_QUERY
}

/**
 * Refetch the index queries an applied batch can have changed. Everything is
 * refetched as before, except the folder tree: it reads every note's path and
 * title, and an autosave that only edits a note's body leaves it unchanged, so
 * it refetches only when {@link folderTreeAffectedBy} says the batch moved it.
 */
function invalidateIndexQueriesFor(changes: readonly FileChange[] | 'all'): void {
  if (changes === 'all') {
    invalidateIndexQueries()
    return
  }
  void queryClient.invalidateQueries({
    queryKey: [INDEX_QUERY_SCOPE],
    predicate: (query) => !isFolderTreeKey(query.queryKey),
  })
  for (const [key, tree] of queryClient.getQueriesData<FolderTreeFolder>({
    queryKey: [INDEX_QUERY_SCOPE],
    predicate: (query) => isFolderTreeKey(query.queryKey),
  })) {
    const refetch = (): void => {
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
    }
    if (tree === undefined) {
      refetch()
      continue
    }
    folderTreeAffectedBy(tree, changes).then(
      (affected) => {
        if (affected) {
          refetch()
        }
      },
      (cause: unknown) => {
        console.error('folder tree change check failed:', cause)
        refetch() // when unsure, refresh
      },
    )
  }
}

function flushThrottledInvalidation(): void {
  const changes = pendingChanges
  pendingChanges = []
  lastInvalidateAt = Date.now()
  invalidateIndexQueriesFor(changes)
}

/**
 * {@link invalidateIndexQueries} with leading+trailing throttling, for the
 * *streaming* callers (applied watcher batches, sweep/pull reindexes): an
 * isolated call fires immediately — a single save keeps its instant refresh
 * — while a burst collapses to one refetch per window, none dropped (the
 * trailing edge always runs). Direct user-action invalidations should keep
 * calling the unthrottled function.
 */
export function throttledInvalidateIndexQueries(changes?: readonly FileChange[]): void {
  // Without the batch nothing can be narrowed: refresh every index query.
  // Past a few hundred changes (a sync pull) checking each costs more than
  // the refetch it could save.
  pendingChanges =
    changes === undefined ||
    pendingChanges === 'all' ||
    pendingChanges.length + changes.length > NARROW_INVALIDATION_LIMIT
      ? 'all'
      : [...pendingChanges, ...changes]
  const elapsed = Date.now() - lastInvalidateAt
  if (elapsed >= INVALIDATE_THROTTLE_MS) {
    flushThrottledInvalidation()
    return
  }
  if (invalidateTimer !== null) {
    return // a trailing refetch is already on its way
  }
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null
    flushThrottledInvalidation()
  }, INVALIDATE_THROTTLE_MS - elapsed)
}

/**
 * "Similar notes" results nest under this key — deliberately *outside*
 * {@link INDEX_QUERY_SCOPE}. Every other index-backed read is one cheap SQLite
 * query, so refetching the lot after any applied batch is fine; a neighbor
 * lookup is up to seventeen vector KNN queries (one per seed chunk), and under
 * the index scope it re-ran for changes it has nothing to do with — a remote
 * sync batch, a Git commit, an asset description, your own keystrokes in an
 * unrelated pane. With its own scope the panel computes once per note per
 * session, which is what it's for.
 */
export const SIMILAR_QUERY_SCOPE = 'similar'

/**
 * Forget cached neighbors on a graph switch. The graph root is part of the key
 * so stale rows could never be *read* after a switch, but these entries are
 * kept for the whole session ({@link SIMILAR_QUERY_SCOPE}) and would otherwise
 * never be collected — memory hygiene, same as the note-row overlays.
 */
export function dropSimilarNotesQueries(): void {
  queryClient.removeQueries({ queryKey: [SIMILAR_QUERY_SCOPE] })
}

/** The iCloud container listing (`icloud_status`) — read by the graph chooser and Settings → iCloud. */
export const ICLOUD_STATUS_QUERY_KEY = ['icloud-status'] as const

/**
 * Forget the cached iCloud container listing after its contents change (a
 * graph delete trashes a container directory). Removal rather than
 * invalidation: with an invalidated cache the chooser would render the stale
 * list — deleted graph included — while the refetch runs.
 */
export function dropIcloudStatusQuery(): void {
  queryClient.removeQueries({ queryKey: ICLOUD_STATUS_QUERY_KEY })
}

/** Chat-history queries nest under this key (e.g. `['chat', 'conversations', root]`). */
export const CHAT_QUERY_SCOPE = 'chat'

/** Refetch chat-history queries; called after a turn save or a delete. */
export function invalidateChatQueries(): void {
  void queryClient.invalidateQueries({ queryKey: [CHAT_QUERY_SCOPE] })
}
