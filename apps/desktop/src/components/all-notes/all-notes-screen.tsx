import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldTag, isDaily, listNotes, listNoteTags, type CollectionSort } from '@reflect/core'
import { Download, LayoutGrid, LayoutTemplate, Layers, List } from '@/components/icons'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useCollection } from '@/hooks/use-collection'
import { useTagType } from '@/hooks/use-tag-type'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { allNotesQueryKey, allNotesTagsQueryKey } from '@/lib/notes/all-notes-query'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useListSelection } from '@/lib/selection/use-list-selection'
import { useScrollRestoration } from '@/lib/use-scroll-restoration'
import { useScrollToIndexBridge } from '@/lib/use-scroll-to-index-bridge'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { useSettings } from '@/providers/settings-provider'
import { AllNotesBulkBar } from './all-notes-bulk-bar'
import { AllNotesFilters } from './all-notes-filters'
import { AllNotesGrid } from './all-notes-grid'
import { AllNotesTable } from './all-notes-table'
import {
  applyCollectionFilters,
  CollectionFilterMenu,
  type CollectionFilter,
} from './collection-filter-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CollectionBoard } from './collection-board'
import { runCollectionExport } from './collection-export'
import { CollectionTable } from './collection-table'
import { NoteListContextMenu } from '@/components/notes/note-context-menu'
import { NoteTrashDialog } from '@/components/notes/note-trash-dialog'
import { NewNoteButton } from './new-note-button'
import { useAllNotesKeyboard } from './use-all-notes-keyboard'
import { isModEvent } from '@meowdown/core'

interface AllNotesScreenProps {
  /** Active tag filter carried by the route (`null` = all non-daily notes). */
  tag: string | null
}

/**
 * The All Notes screen (a routed view, like settings): every non-daily note,
 * newest first, filterable by tag. The active tag lives on the route so
 * back/forward and "open a note, come back" keep the filter. Daily notes are
 * deliberately absent from the unfiltered view, but appear when they match the
 * active tag.
 *
 * Rows are multi-selectable (V1 parity): click to select (⌘ toggle, Shift
 * range), the indicator gutter toggles, the subject or a double-click opens.
 * Keyboard shortcuts act on the selection — ↑/↓ (Shift to extend), ⌘A select
 * all, Return open, ⌘⌫ trash (to the OS trash, after a confirm), Esc clear.
 *
 * Owns its scroll container (the daily stream's shape, not `ScrollRestored`'s)
 * so the header and filter bar stay put while the virtualized table scrolls,
 * wired to the router's per-entry scroll memory by hand.
 */
export function AllNotesScreen({ tag }: AllNotesScreenProps): ReactElement {
  const { graph } = useGraph()
  const { settings, updateSettings, updateSettingsWith } = useSettings()
  // The Collection view exists only while the routed tag has a type (TDR
  // 0005); everywhere else a stored 'table' renders as 'list' — never a
  // broken surface.
  const tagType = useTagType(tag)
  const collectionAvailable = tag !== null && tagType !== null && tagType !== undefined
  // The board additionally needs a select property to group by. Which one is
  // a persisted per-tag choice (like the sort); a saved key the schema no
  // longer declares as a select falls back to the first, never a blank board.
  const tagKey = tag === null ? null : foldTag(tag)
  const selectProperties = useMemo(
    () =>
      collectionAvailable
        ? tagType.properties.filter((property) => property.type === 'select')
        : [],
    [collectionAvailable, tagType],
  )
  const savedGroupKey = tagKey === null ? undefined : settings.collectionGroups[tagKey]
  const boardGroupProperty =
    selectProperties.find((property) => property.key === savedGroupKey) ??
    selectProperties[0] ??
    null
  const boardAvailable = boardGroupProperty !== null
  const view =
    (settings.allNotesView === 'table' && !collectionAvailable) ||
    (settings.allNotesView === 'board' && !boardAvailable)
      ? 'list'
      : settings.allNotesView
  // The two views that render collection rows instead of the notes list.
  const collectionView = view === 'table' || view === 'board'
  // The sort is a persisted per-tag view preference (like task filters):
  // leaving and returning to a collection keeps its order.
  const collectionSort: CollectionSort | null =
    tagKey === null ? null : (settings.collectionSorts[tagKey] ?? null)
  const setCollectionSort = useCallback(
    (sort: CollectionSort | null) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const next = { ...current.collectionSorts }
        if (sort === null) {
          delete next[tagKey]
        } else {
          next[tagKey] = sort
        }
        return { collectionSorts: next }
      })
    },
    [tagKey, updateSettingsWith],
  )
  const setCollectionGroup = useCallback(
    (key: string) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => ({
        collectionGroups: { ...current.collectionGroups, [tagKey]: key },
      }))
    },
    [tagKey, updateSettingsWith],
  )
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  // The scroll container lives in state, not a ref, so scroll restoration
  // re-runs its restore once the element attaches (a callback ref re-renders;
  // a plain ref would still be null during the restore effect on the first,
  // warm-cache-only mount). The table virtualizes against this container as its
  // parent, so it no longer needs the element handed down.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  // The surface, so the keyboard shortcuts can scope to it (and focus it on mount).
  const rootRef = useRef<HTMLDivElement>(null)

  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && graph !== null

  const { data: notes } = useQuery({
    queryKey: allNotesQueryKey(graph?.root, tag),
    queryFn: () => listNotes({ tag }),
    enabled,
  })
  const { data: facets } = useQuery({
    queryKey: allNotesTagsQueryKey(graph?.root),
    queryFn: () => listNoteTags(),
    enabled,
  })
  const collection = useCollection(collectionView ? tag : null, collectionSort)
  // Property filters are ephemeral (unlike the persisted sort) and belong to
  // one tag's schema — a tag switch drops them at render time.
  const [collectionFilters, setCollectionFilters] = useState<CollectionFilter[]>([])
  const [filterTag, setFilterTag] = useState(tag)
  if (filterTag !== tag) {
    setFilterTag(tag)
    setCollectionFilters([])
  }
  const filteredCollection = useMemo(
    () =>
      collection === undefined || tagType === null || tagType === undefined
        ? collection
        : applyCollectionFilters(tagType, collection, collectionFilters),
    [collection, tagType, collectionFilters],
  )

  const ready = notes !== undefined
  const { onScroll } = useScrollRestoration(scrollElement, ready)

  // The flat, render-order paths the selection and its shortcuts act on —
  // the collection's own order while the table view sorts by a property.
  const orderedPaths = useMemo(
    () =>
      collectionView
        ? (filteredCollection ?? []).map((entry) => entry.path)
        : (notes ?? []).map((note) => note.path),
    [collectionView, filteredCollection, notes],
  )
  const selection = useListSelection(orderedPaths)
  const openNote = useCallback(
    (path: string, event?: ModClickEvent) =>
      navigateNoteLink({
        target: routeForPath(path),
        openInNewWindow: event !== undefined && isModEvent(event),
      }),
    [navigateNoteLink],
  )
  const handleFilterSelect = useCallback(
    (next: string | null) => navigate({ kind: 'allNotes', tag: next }),
    [navigate],
  )

  // The bulk-trash confirm: the screen owns whether it's open and which paths it
  // acts on (snapshotted at open time, since the delete prunes the live
  // selection); the dialog owns the delete and its error. Daily rows remain
  // selectable for keyboard navigation, but are never valid trash targets.
  const [confirmingTrash, setConfirmingTrash] = useState(false)
  const [pendingPaths, setPendingPaths] = useState<readonly string[]>([])
  // The live selection as a stable array — the bulk bar takes it whole (tag
  // and move accept dailies) and trash takes it minus the dailies, which the
  // delete helper refuses.
  const selectedPaths = useMemo(() => [...selection.selected], [selection.selected])
  const trashableSelectedPaths = useMemo(
    () => selectedPaths.filter((path) => !isDaily(path)),
    [selectedPaths],
  )
  const openTrashConfirm = useCallback(() => {
    if (trashableSelectedPaths.length === 0) {
      return
    }
    setPendingPaths(trashableSelectedPaths)
    setConfirmingTrash(true)
  }, [trashableSelectedPaths])

  // The table owns the virtualizer; the bridge lets the keyboard nav pull an
  // off-screen (unmounted) row into view through the virtualizer's scrollToIndex.
  const { scrollToIndex, registerScrollToIndex } = useScrollToIndexBridge()

  useAllNotesKeyboard({
    selection,
    // The card grid and the board have no selection affordance, so the list
    // shortcuts would act on rows the user can't see selected — disarm them.
    orderedPaths: view === 'grid' || view === 'board' ? [] : orderedPaths,
    onOpen: openNote,
    onRequestTrash: openTrashConfirm,
    rootRef,
    scrollToIndex,
  })

  // Move focus into the surface on mount so the shortcuts work the moment you
  // navigate here, without first clicking the list (mirrors the Tasks view).
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      aria-label="All notes"
      // `relative`: the floating bulk bar positions against this root.
      className="relative flex h-full min-h-0 flex-col outline-none"
    >
      <AllNotesBulkBar
        paths={selectedPaths}
        trashablePaths={trashableSelectedPaths}
        notes={notes}
        tagType={collectionAvailable ? tagType : null}
        onRequestTrash={openTrashConfirm}
        onDone={selection.clear}
      />
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 py-4 pl-12 pr-7">
        <h1 className="text-[15px] font-semibold text-text">Notes</h1>
        <div className="flex flex-wrap items-center gap-3">
          <AllNotesFilters tag={tag} facets={facets ?? []} onSelect={handleFilterSelect} />
          {view === 'board' && selectProperties.length > 1 ? (
            <Select
              value={boardGroupProperty?.key ?? ''}
              items={Object.fromEntries(
                selectProperties.map((property) => [property.key, property.name]),
              )}
              onValueChange={(value) => {
                if (typeof value === 'string' && value !== '') {
                  setCollectionGroup(value)
                }
              }}
            >
              <SelectTrigger aria-label="Group by" data-size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectProperties.map((property) => (
                  <SelectItem key={property.key} value={property.key}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {collectionView && collectionAvailable ? (
            <>
              <CollectionFilterMenu
                type={tagType}
                entries={collection}
                filters={collectionFilters}
                onChange={setCollectionFilters}
              />
              <button
                type="button"
                aria-label="Export collection as CSV"
                title="Export CSV"
                onClick={() => {
                  void runCollectionExport(tag, tagType, filteredCollection ?? [])
                }}
                className="flex size-6 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-secondary"
              >
                <Download aria-hidden className="size-3.5" />
              </button>
            </>
          ) : null}
          <div
            role="group"
            aria-label="Layout"
            className="flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
          >
            <button
              type="button"
              aria-label="List view"
              aria-pressed={view === 'list'}
              onClick={() => {
                updateSettings({ allNotesView: 'list' })
              }}
              className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                view === 'list'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <List aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              onClick={() => {
                updateSettings({ allNotesView: 'grid' })
              }}
              className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                view === 'grid'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <LayoutGrid aria-hidden className="size-3.5" />
            </button>
            {collectionAvailable ? (
              <button
                type="button"
                aria-label="Collection view"
                aria-pressed={view === 'table'}
                onClick={() => {
                  updateSettings({ allNotesView: 'table' })
                }}
                className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                  view === 'table'
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Layers aria-hidden className="size-3.5" />
              </button>
            ) : null}
            {boardAvailable ? (
              <button
                type="button"
                aria-label="Board view"
                aria-pressed={view === 'board'}
                onClick={() => {
                  updateSettings({ allNotesView: 'board' })
                }}
                className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                  view === 'board'
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <LayoutTemplate aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </div>
          <NewNoteButton tag={tag} />
        </div>
      </header>
      {/* One context menu for the whole list — rows and cards carry
          data-note-path; the menu resolves the note from the click. It wraps
          the scroll container from OUTSIDE: its wrappers are display:contents,
          and the table's virtualizer measures its direct parent — a wrapper
          between the two would hand it a zero-height viewport. */}
      <NoteListContextMenu>
        <div
          ref={setScrollElement}
          data-testid="all-notes-scroll"
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto"
        >
          {view === 'grid' ? (
            <AllNotesGrid notes={notes} tag={tag} onOpen={openNote} />
          ) : view === 'board' && boardGroupProperty !== null ? (
            <CollectionBoard
              entries={filteredCollection}
              property={boardGroupProperty}
              onOpen={openNote}
            />
          ) : view === 'table' && collectionAvailable ? (
            <CollectionTable
              entries={filteredCollection}
              tag={tag}
              type={tagType}
              selection={selection}
              sort={collectionSort}
              onSortChange={setCollectionSort}
              onOpen={openNote}
              registerScrollToIndex={registerScrollToIndex}
            />
          ) : (
            <AllNotesTable
              notes={notes}
              tag={tag}
              selection={selection}
              onOpen={openNote}
              registerScrollToIndex={registerScrollToIndex}
            />
          )}
        </div>
      </NoteListContextMenu>

      <NoteTrashDialog
        open={confirmingTrash}
        onOpenChange={setConfirmingTrash}
        paths={pendingPaths}
        onTrashed={selection.clear}
      />
    </div>
  )
}
