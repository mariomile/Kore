import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, SearchOff } from '@/components/icons'
import { searchWithFilters, type FilteredSearchHit } from '@kore/core'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { NoteRowList } from '@/mobile/note-row-list'
import { rowForHit } from '@/mobile/screens/all-notes'
import {
  buildAllNotesSearch,
  EMPTY_ALL_NOTES_FILTERS,
  searchPlanFor,
} from '@/mobile/search-filters/filter-state'
import { SearchInput } from '@/mobile/search-input'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * The pull-to-search indicator: a "Search" capsule that drops in from above
 * the top edge as the pull travels (`--pull`, 0…1, written by
 * {@link usePullToSearch}) and fills with the accent once letting go would
 * open search (`data-armed`). Pure CSS on purpose: the pull repaints it on
 * every touchmove without a React render, and only `transform` moves.
 */
export function PullToSearchIndicator({ ref }: { ref: Ref<HTMLDivElement> }): ReactElement {
  return (
    <div
      ref={ref}
      aria-hidden
      className="group pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 0.375rem)',
        transform: 'translate3d(0, calc((var(--pull, 0) - 1) * (100% + 0.5rem)), 0)',
      }}
    >
      <span className="flex h-11 items-center gap-2 rounded-full bg-surface px-5 text-[15px] font-medium text-text-secondary shadow-[0_4px_20px_rgb(0_0_0/0.12)] ring-1 ring-foreground/10 transition-colors duration-150 group-data-armed:bg-primary group-data-armed:text-primary-foreground group-data-armed:ring-transparent motion-reduce:transition-none">
        <Search aria-hidden className="size-[18px]" />
        Search
      </span>
    </div>
  )
}

interface GlobalSearchSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Global search on iPhone, opened by pulling down from the top of a screen
 * (Spotlight's gesture): a full-screen sheet over whatever is showing, its
 * field focused, results from the same index query as the All tab's search
 * (so an empty field shows the All tab's recent-first feed straight from its
 * cache). Opening a result closes the sheet and pushes the note; Cancel
 * returns to the screen underneath, untouched.
 */
export function GlobalSearchSheet({ open, onOpenChange }: GlobalSearchSheetProps): ReactNode {
  if (!open) {
    return null
  }
  // Portaled to the end of <body>: above the shell's status pills, while the
  // row actions' dialogs (portaled later) still land above the sheet.
  return createPortal(<GlobalSearchSurface onClose={() => onOpenChange(false)} />, document.body)
}

function GlobalSearchSurface({ onClose }: { onClose: () => void }): ReactElement {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const queryClient = useQueryClient()
  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && graph !== null
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  // Focus on mount: the sheet exists to type into. The same programmatic
  // focus the tab double-tap uses to raise the keyboard.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const deferredQuery = useDeferredValue(query)
  const parsed = useMemo(
    () => buildAllNotesSearch(deferredQuery, EMPTY_ALL_NOTES_FILTERS, null),
    [deferredQuery],
  )
  // The All tab's query key and shape: an empty field reuses its cached feed.
  const queryKey = [INDEX_QUERY_SCOPE, graph?.root, 'mobile-all-notes', parsed]
  const { data: feed, isError } = useQuery({
    queryKey,
    queryFn: async (): Promise<{ hits: FilteredSearchHit[]; recall: boolean }> => {
      const plan = searchPlanFor(parsed)
      return { hits: await searchWithFilters(parsed, plan), recall: plan.pinnedFirst === true }
    },
    enabled,
    placeholderData: keepPreviousData,
  })
  const rows = useMemo(() => (feed?.hits ?? []).map(rowForHit), [feed])

  const removeDeletedRow = (path: string): void => {
    // Same as the All tab: drop the row now, let the delete's reindex echo
    // invalidate once the index has caught up.
    queryClient.setQueriesData<{ hits: FilteredSearchHit[]; recall: boolean }>(
      { queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'mobile-all-notes'] },
      (cached) => cached && { ...cached, hits: cached.hits.filter((hit) => hit.path !== path) },
    )
  }

  return (
    <div
      ref={scopeRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-x-0 top-0 z-50 flex flex-col bg-surface-app animate-in duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] fade-in-0 slide-in-from-top-4 motion-reduce:animate-none"
      style={
        {
          height: 'calc(100dvh - var(--keyboard-height, 0px))',
          // The sheet covers the tab bar: the result list pads only past the
          // home indicator, not the root's published tab bar height.
          '--mobile-tab-bar-height': 'env(safe-area-inset-bottom)',
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }}
    >
      <header
        ref={barRef}
        className="mobile-glass-bar absolute inset-x-0 top-0 z-30 flex items-center gap-1 px-4 pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <SearchInput
          ref={inputRef}
          placeholder="Search anything…"
          aria-label="Search all notes"
          enterKeyHint="search"
          value={query}
          onValueChange={setQuery}
        />
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 shrink-0 items-center px-2 text-base font-medium text-accent active:opacity-60"
        >
          Cancel
        </button>
      </header>
      {isError ? (
        <Message icon={<SearchOff className="size-6" />} text="Couldn’t search your notes." />
      ) : enabled && feed === undefined ? (
        <div
          className="flex flex-1 items-center justify-center"
          style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
          aria-label="Loading notes"
        >
          <Spinner className="size-5 text-text-muted" />
        </div>
      ) : rows.length === 0 ? (
        <Message
          icon={<SearchOff className="size-6" />}
          text={parsed.text === '' ? 'No notes yet' : 'No matches'}
        />
      ) : (
        <div
          className={cn('flex min-h-0 flex-1 flex-col', query !== deferredQuery && 'opacity-80')}
        >
          <NoteRowList
            rows={rows}
            onOpen={(path) => {
              onClose()
              navigate(routeForPath(path))
            }}
            onDeleted={removeDeletedRow}
          />
        </div>
      )}
    </div>
  )
}

function Message({ icon, text }: { icon: ReactElement; text: string }): ReactElement {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted"
      style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
    >
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  )
}
