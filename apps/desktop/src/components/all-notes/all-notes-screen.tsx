import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  foldTag,
  isDaily,
  listNotes,
  listNoteTags,
  type AllNotesView,
  type CollectionSort,
  type SavedCollectionView,
} from '@reflect/core'
import {
  Calendar,
  Check,
  Download,
  LayoutGrid,
  LayoutTemplate,
  Layers,
  List,
  Sliders,
} from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { cn } from '@/lib/utils'
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
import { CollectionBoard, groupableProperties } from './collection-board'
import { calendarProperty, CollectionCalendar } from './collection-calendar'
import { CollectionViewsMenu } from './collection-views-menu'
import { runCollectionExport } from './collection-export'
import { CollectionImportButton } from './collection-import'
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

/** Stable empty widths map, so an untouched tag never re-keys the memo. */
const EMPTY_WIDTHS: Record<string, number> = {}

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
  // The board additionally needs a groupable property (select, checkbox, or
  // relation). Which one is a persisted per-tag choice (like the sort); a
  // saved key the schema no longer declares as groupable falls back to the
  // first, never a blank board.
  const tagKey = tag === null ? null : foldTag(tag)
  const boardProperties = useMemo(
    () => (collectionAvailable ? groupableProperties(tagType) : []),
    [collectionAvailable, tagType],
  )
  const savedGroupKey = tagKey === null ? undefined : settings.collectionGroups[tagKey]
  const boardGroupProperty =
    boardProperties.find((property) => property.key === savedGroupKey) ?? boardProperties[0] ?? null
  const boardAvailable = boardGroupProperty !== null
  // The calendar needs a date property to place rows by.
  const calendarDateProperty = collectionAvailable ? calendarProperty(tagType) : null
  const calendarAvailable = calendarDateProperty !== null
  // On a tag route, that tag's own persisted view mode wins over the global
  // preference — the board you left on one tag doesn't chase you onto the
  // next; the toggles write per-tag there, global elsewhere.
  const requestedView =
    (tagKey === null ? undefined : settings.collectionViewModes[tagKey]) ?? settings.allNotesView
  const view =
    (requestedView === 'table' && !collectionAvailable) ||
    (requestedView === 'board' && !boardAvailable) ||
    (requestedView === 'calendar' && !calendarAvailable)
      ? 'list'
      : requestedView
  const setViewMode = useCallback(
    (mode: AllNotesView) => {
      if (tagKey === null) {
        updateSettings({ allNotesView: mode })
      } else {
        updateSettingsWith((current) => ({
          collectionViewModes: { ...current.collectionViewModes, [tagKey]: mode },
        }))
      }
    },
    [tagKey, updateSettings, updateSettingsWith],
  )
  // The views that render collection rows instead of the notes list.
  const collectionView = view === 'table' || view === 'board' || view === 'calendar'
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
  // Column layout (hidden keys, manual widths) is a persisted per-tag view
  // preference like the sort; the table renders the visible subset.
  const columnsSetting = tagKey === null ? undefined : settings.collectionColumns[tagKey]
  const hiddenColumns = useMemo(() => new Set(columnsSetting?.hidden ?? []), [columnsSetting])
  const columnWidths = columnsSetting?.widths ?? EMPTY_WIDTHS
  const visibleTagType = useMemo(
    () =>
      collectionAvailable
        ? { properties: tagType.properties.filter((entry) => !hiddenColumns.has(entry.key)) }
        : null,
    [collectionAvailable, tagType, hiddenColumns],
  )
  const setColumnWidth = useCallback(
    (key: string, rem: number) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const entry = current.collectionColumns[tagKey] ?? { hidden: [], widths: {} }
        return {
          collectionColumns: {
            ...current.collectionColumns,
            [tagKey]: { ...entry, widths: { ...entry.widths, [key]: rem } },
          },
        }
      })
    },
    [tagKey, updateSettingsWith],
  )
  const toggleColumnHidden = useCallback(
    (key: string) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const entry = current.collectionColumns[tagKey] ?? { hidden: [], widths: {} }
        const hidden = entry.hidden.includes(key)
          ? entry.hidden.filter((hiddenKey) => hiddenKey !== key)
          : [...entry.hidden, key]
        return {
          collectionColumns: { ...current.collectionColumns, [tagKey]: { ...entry, hidden } },
        }
      })
    },
    [tagKey, updateSettingsWith],
  )
  // The "+" in the table header opens the tag's schema dialog in place.
  const [editingSchema, setEditingSchema] = useState(false)
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

  // Saved views: named bundles of mode + sort + grouping + filters, per tag.
  const savedViews = tagKey === null ? [] : (settings.collectionSavedViews[tagKey] ?? [])
  const saveCurrentView = useCallback(
    (name: string) => {
      if (tagKey === null) {
        return
      }
      const entry: SavedCollectionView = {
        id: crypto.randomUUID(),
        name,
        view: view === 'board' ? 'board' : 'table',
        sort: collectionSort,
        group: boardGroupProperty?.key ?? null,
        filters: [...collectionFilters],
      }
      updateSettingsWith((current) => ({
        collectionSavedViews: {
          ...current.collectionSavedViews,
          [tagKey]: [...(current.collectionSavedViews[tagKey] ?? []), entry],
        },
      }))
    },
    [tagKey, view, collectionSort, boardGroupProperty, collectionFilters, updateSettingsWith],
  )
  const deleteSavedView = useCallback(
    (id: string) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const remaining = (current.collectionSavedViews[tagKey] ?? []).filter(
          (entry) => entry.id !== id,
        )
        const next = { ...current.collectionSavedViews }
        if (remaining.length === 0) {
          delete next[tagKey]
        } else {
          next[tagKey] = remaining
        }
        return { collectionSavedViews: next }
      })
    },
    [tagKey, updateSettingsWith],
  )
  const applySavedView = useCallback(
    (saved: SavedCollectionView) => {
      setViewMode(saved.view)
      setCollectionSort(saved.sort)
      if (saved.group !== null) {
        setCollectionGroup(saved.group)
      }
      setCollectionFilters([...saved.filters])
    },
    [setViewMode, setCollectionSort, setCollectionGroup],
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
    // The card grid, board, and calendar have no selection affordance, so the
    // list shortcuts would act on rows the user can't see selected — disarm.
    orderedPaths: view === 'grid' || view === 'board' || view === 'calendar' ? [] : orderedPaths,
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
          {view === 'board' && boardProperties.length > 1 ? (
            <Select
              value={boardGroupProperty?.key ?? ''}
              items={Object.fromEntries(
                boardProperties.map((property) => [property.key, property.name]),
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
                {boardProperties.map((property) => (
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
              <CollectionViewsMenu
                views={savedViews}
                onApply={applySavedView}
                onSave={saveCurrentView}
                onDelete={deleteSavedView}
              />
              {view === 'table' ? (
                <Popover>
                  <PopoverTrigger
                    aria-label="Columns"
                    title="Show or hide columns"
                    className="flex size-6 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-secondary"
                  >
                    <Sliders aria-hidden className="size-3.5" />
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={4} className="w-56 p-1">
                    {tagType.properties.map((property) => {
                      const hidden = hiddenColumns.has(property.key)
                      return (
                        <button
                          key={property.key}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={!hidden}
                          onClick={() => toggleColumnHidden(property.key)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-hover"
                        >
                          <Check
                            aria-hidden
                            className={cn(
                              'size-3.5 shrink-0',
                              hidden ? 'opacity-0' : 'opacity-100',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-left">{property.name}</span>
                        </button>
                      )
                    })}
                  </PopoverContent>
                </Popover>
              ) : null}
              {tag !== null ? <CollectionImportButton tag={tag} type={tagType} /> : null}
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
                setViewMode('list')
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
                setViewMode('grid')
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
                  setViewMode('table')
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
                  setViewMode('board')
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
            {calendarAvailable ? (
              <button
                type="button"
                aria-label="Calendar view"
                aria-pressed={view === 'calendar'}
                onClick={() => {
                  setViewMode('calendar')
                }}
                className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                  view === 'calendar'
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Calendar aria-hidden className="size-3.5" />
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
          ) : collectionAvailable &&
            view === 'calendar' &&
            calendarDateProperty !== null &&
            tag !== null ? (
            <CollectionCalendar
              entries={filteredCollection}
              property={calendarDateProperty}
              tag={tag}
              type={tagType}
              onOpen={openNote}
            />
          ) : collectionAvailable &&
            view === 'board' &&
            boardGroupProperty !== null &&
            tag !== null ? (
            <CollectionBoard
              entries={filteredCollection}
              tag={tag}
              type={tagType}
              property={boardGroupProperty}
              onOpen={openNote}
            />
          ) : view === 'table' && collectionAvailable && visibleTagType !== null ? (
            <CollectionTable
              entries={filteredCollection}
              tag={tag}
              type={visibleTagType}
              selection={selection}
              sort={collectionSort}
              onSortChange={setCollectionSort}
              columnWidths={columnWidths}
              onColumnWidthChange={setColumnWidth}
              onEditSchema={() => setEditingSchema(true)}
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
      {editingSchema && tag !== null ? (
        <TagConfigDialog tag={tag} onClose={() => setEditingSchema(false)} />
      ) : null}
    </div>
  )
}
