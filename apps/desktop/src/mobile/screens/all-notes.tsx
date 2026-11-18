import { useDeferredValue, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, List, Note, SearchOff, SortVertical } from '@/components/icons'
import {
  displayNoteTitle,
  foldTag,
  listNoteTags,
  parseHighlights,
  searchWithFilters,
  sortNoteList,
  type AllNotesSort,
  type FilteredSearchHit,
  type HighlightSegment,
  type NoteTagFacet,
} from '@kore/core'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { hapticImpactLight } from '@/mobile/haptics'
import { NoteCardGrid } from '@/mobile/note-card-grid'
import { FilterBar } from '@/mobile/search-filters/filter-bar'
import {
  buildAllNotesSearch,
  pendingTagToken,
  searchPlanFor,
  type AllNotesFilters,
} from '@/mobile/search-filters/filter-state'
import { NoteRowList } from '@/mobile/note-row-list'
import { SearchInput } from '@/mobile/search-input'
import type { NoteRowModel } from '@/mobile/swipeable-note-row'
import { useArrivalFocus } from '@/mobile/use-arrival-focus'
import { AllNotesSortDrawer, allNotesSortSummary } from '@/mobile/all-notes-sort-drawer'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useSearchHeaderFocus } from '@/mobile/use-search-header-focus'
import { useSlidingIndicator } from '@/mobile/use-sliding-indicator'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

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

/** The tags matching a half-typed `#…` token, by folded-substring match. */
export function matchingTagFacets(facets: NoteTagFacet[], partial: string): NoteTagFacet[] {
  const needle = foldTag(partial)
  return facets.filter((facet) => foldTag(facet.tag).includes(needle))
}

interface MobileAllNotesProps {
  /** The live search text — lifted to the shell so it survives navigation. */
  query: string
  onQueryChange: (query: string) => void
  /** The badge filters — lifted to the shell so they survive navigation. */
  filters: AllNotesFilters
  onFiltersChange: (filters: AllNotesFilters) => void
}

/**
 * The All tab (Plan 19, V1 parity): a virtualized fixed-row note list *or*
 * a masonry card grid (the same `allNotesView` preference as desktop), with an
 * embedded search bar and AND-composed filter badges. Everything is one
 * search path ({@link buildAllNotesSearch} → `searchWithFilters`, run per
 * {@link searchPlanFor}): the plain list is the empty query's recall feed
 * (notes only, pinned first, uncapped), badges and typed tokens narrow it,
 * and free text switches to ranked FTS. A trailing `#…` token switches the bar into
 * tag matching (V1): suggestions replace the badge row until the tag is
 * picked or the token completed. A tag's own route is its type page
 * ({@link MobileTypePage}), not this list. The card grid is a reading
 * layout — tap opens; pin and delete stay with the swipeable list.
 */
export function MobileAllNotes({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
}: MobileAllNotesProps): ReactElement {
  const searchHeaderFocus = useSearchHeaderFocus()
  const { graph } = useGraph()
  const { settings, updateSettings } = useSettings()
  const { navigate, arrivalSeq, arrivalFocusEditor } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const queryClient = useQueryClient()
  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && graph !== null

  // The All-tab double-tap (`focusEditor` arrivals) lands in the search bar,
  // the tab's capture surface — the daily double-tap's All-flavored twin.
  const searchInputRef = useRef<HTMLInputElement>(null)
  useArrivalFocus({ arrivalSeq, arrivalFocusEditor, target: searchInputRef })

  // Defer the query the index sees (desktop's search debounce): fast typing
  // coalesces while the input stays live, and a seeded query (a `search`
  // history entry) catches up within a frame instead of a fixed delay.
  const deferredQuery = useDeferredValue(query)
  const pending = pendingTagToken(query)
  const parsed = useMemo(
    () => buildAllNotesSearch(deferredQuery, filters, null),
    [deferredQuery, filters],
  )

  const { data: facets } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'all-notes-tags'],
    queryFn: () => listNoteTags(),
    enabled,
  })
  const {
    data: feed,
    isError,
    refetch,
  } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'mobile-all-notes', parsed],
    queryFn: async (): Promise<AllNotesFeed> => {
      const plan = searchPlanFor(parsed)
      return { hits: await searchWithFilters(parsed, plan), recall: plan.pinnedFirst === true }
    },
    enabled,
    // Typing re-keys the query as the deferred value settles; holding the
    // previous rows avoids a blank flash between keystrokes.
    placeholderData: keepPreviousData,
  })
  const hits = feed?.hits

  // The no-text feed (plain or badge-filtered) follows the persisted sort,
  // the Mac list's; typed text keeps relevance ranking. Each result records
  // which kind it is, so the placeholder held while the next query runs keeps
  // its own order, and a sort change reorders in memory with no index call.
  // The index already returns the default order (pinned, then newest), so
  // only another sort pays for a client-side pass.
  const sort = settings.allNotesSort
  const rows = useMemo(() => {
    const ordered =
      feed?.recall === true && sort !== 'updated-desc' ? sortNoteList(feed.hits, sort) : hits
    return (ordered ?? []).map(rowForHit)
  }, [feed, hits, sort])
  const [sorting, setSorting] = useState(false)
  const pristine = parsed.text === '' && !parsed.filtered
  const view: AllNotesLayout = settings.allNotesView === 'grid' ? 'grid' : 'list'
  const setView = (next: AllNotesLayout): void => {
    hapticImpactLight()
    updateSettings({ allNotesView: next })
  }

  const removeDeletedRow = (path: string): void => {
    queryClient.setQueriesData<AllNotesFeed>(
      { queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'mobile-all-notes'] },
      (cached) => cached && { ...cached, hits: cached.hits.filter((hit) => hit.path !== path) },
    )
    // Do not invalidate yet: the index can still contain the deleted row and
    // would briefly resurrect it. `deleteNote`'s local-write echo reindexes,
    // then invalidates the full index scope (including tag facets) once the
    // projection has caught up.
  }

  const addPendingTag = (facet: NoteTagFacet): void => {
    const key = foldTag(facet.tag)
    if (!filters.tags.includes(key)) {
      onFiltersChange({ ...filters, tags: [...filters.tags, key] })
    }
    onQueryChange(pending?.rest ?? '')
  }

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <header
        ref={barRef}
        className="mobile-glass-bar absolute inset-x-0 top-0 z-30 space-y-2 px-4 pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)' }}
      >
        <h1
          className={`overflow-hidden text-[28px] font-semibold tracking-tight transition-[height,opacity] duration-200 motion-reduce:transition-none ${
            searchHeaderFocus.isFocused ? 'h-0 opacity-0' : 'h-9 opacity-100'
          }`}
        >
          Notes
        </h1>
        <div className="flex items-center gap-1">
          <SearchInput
            ref={searchInputRef}
            placeholder="Search anything…"
            aria-label="Search notes"
            value={query}
            onValueChange={onQueryChange}
            onFocus={searchHeaderFocus.onFocus}
            onBlur={searchHeaderFocus.onBlur}
          />
          <SortButton
            sort={sort}
            onPress={() => {
              hapticImpactLight()
              setSorting(true)
            }}
          />
          <AllNotesLayoutToggle view={view} onChange={setView} />
        </div>
        {pending !== null ? (
          <TagSuggestions
            facets={matchingTagFacets(facets ?? [], pending.partial)}
            onPick={addPendingTag}
          />
        ) : (
          <FilterBar filters={filters} onFiltersChange={onFiltersChange} facets={facets ?? []} />
        )}
      </header>
      {/* Undefined hits mean "still fetching" only while the query can run —
          with no bridge/graph it never will, and the empty state is honest. */}
      {isError ? (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
        >
          <SearchOff className="size-6 text-text-muted" />
          <p className="text-sm text-text-muted">Couldn’t load your notes.</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : enabled && hits === undefined ? (
        <div
          className="flex flex-1 items-center justify-center"
          style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
          aria-label="Loading notes"
        >
          <Spinner className="size-5 text-text-muted" />
        </div>
      ) : (hits ?? []).length === 0 ? (
        pristine ? (
          <Empty icon={<Note className="size-6" />} message="No notes yet" />
        ) : (
          <Empty icon={<SearchOff className="size-6" />} message="No matches" />
        )
      ) : view === 'grid' ? (
        <NoteCardGrid rows={rows} onOpen={(path) => navigate(routeForPath(path))} />
      ) : (
        <NoteRowList
          rows={rows}
          onOpen={(path) => navigate(routeForPath(path))}
          onDeleted={removeDeletedRow}
        />
      )}
      <AllNotesSortDrawer
        open={sorting}
        onOpenChange={setSorting}
        sort={sort}
        onSortChange={(next) => updateSettings({ allNotesSort: next })}
      />
    </div>
  )
}

/**
 * Opens the sort sheet. Tinted while the list is in a non-default order, so
 * an alphabetical list never reads as "recent first" at a glance.
 */
function SortButton({ sort, onPress }: { sort: AllNotesSort; onPress: () => void }): ReactElement {
  const custom = sort !== 'updated-desc'
  // The name stays "Sort" (the current order is the description), so the
  // control never collides with other buttons by name ("Newest" vs "New").
  const summaryId = useId()
  return (
    <button
      type="button"
      aria-label="Sort"
      aria-describedby={summaryId}
      aria-haspopup="dialog"
      onClick={onPress}
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none',
        custom
          ? 'bg-accent-soft text-accent-soft-text'
          : 'bg-surface-hover text-text-muted active:bg-surface-active',
      )}
    >
      <SortVertical aria-hidden className="size-4" />
      <span id={summaryId} className="sr-only">
        {allNotesSortSummary(sort)}
      </span>
    </button>
  )
}

/** One All-tab query result, tagged with whether it is the no-text recall feed. */
interface AllNotesFeed {
  hits: FilteredSearchHit[]
  recall: boolean
}

/** The `#…` tag-matching mode's suggestion row (replaces the badge row). */
function TagSuggestions({
  facets,
  onPick,
}: {
  facets: NoteTagFacet[]
  onPick: (facet: NoteTagFacet) => void
}): ReactElement {
  if (facets.length === 0) {
    return <p className="pb-1 text-xs text-text-muted">No matching types</p>
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="Matching types">
      {facets.map((facet) => (
        <button
          key={facet.tag}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onPick(facet)}
          className="flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border px-4 text-sm font-medium text-text-muted"
        >
          #{facet.tag}
          <span className="opacity-60">{facet.count}</span>
        </button>
      ))}
    </div>
  )
}

function Empty({ icon, message }: { icon: ReactElement; message: string }): ReactElement {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted"
      style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
    >
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  )
}

/** The Notes tab's two layouts (the same `allNotesView` setting as desktop). */
type AllNotesLayout = 'list' | 'grid'

interface AllNotesLayoutToggleProps {
  view: AllNotesLayout
  onChange: (view: AllNotesLayout) => void
}

/** Compact list/grid switch — the same labels as desktop so the setting is one. */
function AllNotesLayoutToggle({ view, onChange }: AllNotesLayoutToggleProps): ReactElement {
  const controlRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)

  useSlidingIndicator(controlRef, indicatorRef, view)

  return (
    <div
      ref={controlRef}
      role="group"
      aria-label="Layout"
      className="relative flex shrink-0 items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
    >
      <span
        ref={indicatorRef}
        data-sliding-indicator
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-10 rounded-full bg-surface opacity-0 shadow-sm transition-[transform,width,height,opacity] duration-200 ease-swift motion-reduce:transition-none"
      />
      <button
        type="button"
        data-sliding-value="list"
        aria-label="List view"
        aria-pressed={view === 'list'}
        onClick={() => onChange('list')}
        className={`relative z-20 flex size-11 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none ${
          view === 'list' ? 'text-text' : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <List aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        data-sliding-value="grid"
        aria-label="Grid view"
        aria-pressed={view === 'grid'}
        onClick={() => onChange('grid')}
        className={`relative z-20 flex size-11 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none ${
          view === 'grid' ? 'text-text' : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <LayoutGrid aria-hidden className="size-4" />
      </button>
    </div>
  )
}
