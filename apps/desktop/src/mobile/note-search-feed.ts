import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  displayNoteTitle,
  parseHighlights,
  searchWithFilters,
  type FilteredSearchHit,
  type HighlightSegment,
  type ParsedSearchQuery,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { searchPlanFor } from '@/mobile/search-filters/filter-state'
import type { NoteRowModel } from '@/mobile/swipeable-note-row'
import { useGraph } from '@/providers/graph-provider'

/** One note-search result, tagged with whether it is the no-text recall feed. */
export interface NoteSearchFeed {
  hits: FilteredSearchHit[]
  recall: boolean
}

const FEED_KEY = 'mobile-all-notes'

/**
 * The mobile note search: the All tab's list and the pull-down search sheet
 * run this one query ({@link searchPlanFor} over `searchWithFilters`) under
 * one key, so the sheet's empty field is the All tab's cached recent feed and
 * a delete in either drops the row from both.
 */
export function useNoteSearchFeed(search: ParsedSearchQuery): {
  feed: NoteSearchFeed | undefined
  /** False while the bridge or graph is missing: the query will never run. */
  enabled: boolean
  isError: boolean
  refetch: () => unknown
  removeDeletedRow: (path: string) => void
} {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const enabled = useBridgeReady() && graph !== null
  const { data, isError, refetch } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, FEED_KEY, search],
    queryFn: async (): Promise<NoteSearchFeed> => {
      const plan = searchPlanFor(search)
      return { hits: await searchWithFilters(search, plan), recall: plan.pinnedFirst === true }
    },
    enabled,
    // Typing re-keys the query as the deferred value settles; holding the
    // previous rows avoids a blank flash between keystrokes.
    placeholderData: keepPreviousData,
  })

  const removeDeletedRow = (path: string): void => {
    queryClient.setQueriesData<NoteSearchFeed>(
      { queryKey: [INDEX_QUERY_SCOPE, graph?.root, FEED_KEY] },
      (cached) => cached && { ...cached, hits: cached.hits.filter((hit) => hit.path !== path) },
    )
    // Do not invalidate yet: the index can still contain the deleted row and
    // would briefly resurrect it. `deleteNote`'s local-write echo reindexes,
    // then invalidates the full index scope (including tag facets) once the
    // projection has caught up.
  }

  return { feed: data, enabled, isError, refetch, removeDeletedRow }
}

/**
 * The title as a reader sees it, with the search matches still marked. A
 * title holding link syntax (`# [[Folder/Note|Note]]`) shows its display
 * text, the way the editor renders that heading; the marks are re-found in
 * the display text, since the raw title's offsets no longer line up.
 */
export function displayTitleSegments(hit: FilteredSearchHit): HighlightSegment[] {
  const segments = parseHighlights(hit.highlightedTitle)
  const display = displayNoteTitle(hit.title)
  if (display === hit.title) {
    return segments
  }
  const folded = display.toLowerCase()
  const terms = segments
    .filter((segment) => segment.highlighted)
    .map((segment) => segment.text.toLowerCase())
    .filter((term) => term.trim() !== '')
  if (terms.length === 0 || folded.length !== display.length) {
    return [{ text: display, highlighted: false }]
  }
  const marked = Array.from({ length: display.length }, () => false)
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      marked.fill(true, at, at + term.length)
    }
  }
  const out: HighlightSegment[] = []
  for (let index = 0; index < display.length; index += 1) {
    const last = out.at(-1)
    if (last !== undefined && last.highlighted === marked[index]) {
      last.text += display[index]
    } else {
      out.push({ text: display[index]!, highlighted: marked[index]! })
    }
  }
  return out
}

/** A search hit resolved into the shared row shape. */
export function rowForHit(hit: FilteredSearchHit): NoteRowModel {
  return {
    path: hit.path,
    titleSegments: displayTitleSegments(hit),
    mtime: hit.mtime,
    isPinned: hit.isPinned,
    canDelete: hit.dailyDate === null,
    snippet:
      hit.snippet !== null
        ? parseHighlights(hit.snippet)
        : hit.preview.trim() === ''
          ? []
          : [{ text: hit.preview, highlighted: false }],
  }
}
