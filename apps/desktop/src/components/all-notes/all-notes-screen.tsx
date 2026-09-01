import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldTag, isDaily, listNotes, listNoteTags } from '@reflect/core'
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
import { CollectionBoard, tableGroupRows } from './collection-board'
import { CollectionCalendar } from './collection-calendar'
import { CollectionViewsMenu } from './collection-views-menu'
import { runCollectionExport } from './collection-export'
import { CollectionImportButton } from './collection-import'
import { CollectionTable } from './collection-table'
import { NoteListContextMenu } from '@/components/notes/note-context-menu'
import { NoteTrashDialog } from '@/components/notes/note-trash-dialog'
import { ScrollVeil } from '@/components/scroll-veil'
import { NewNoteButton } from './new-note-button'
import { TagPageTitle } from './tag-page-title'
import { useAllNotesKeyboard } from './use-all-notes-keyboard'
import { useCollectionSavedViews, useCollectionViewSettings } from './use-collection-view-settings'
import { isModEvent } from '@meowdown/core'

interface AllNotesScreenProps {
  /** Active tag filter carried by the route (`null` = all non-daily notes). */
  tag: string | null
}

/**
 * The All Notes screen (a routed view, like settings): every non-daily note,
 * newest first. The active tag lives on the route so back/forward and "open a
 * note, come back" keep it. Daily notes are deliberately absent from the
 * unfiltered view, but appear when they match the active tag.
 *
 * A routed tag renders as that tag's own page rather than "All Notes with a
 * filter on": the tag is the title (with an All notes breadcrumb back), the
 * filter tabs stay on the unfiltered view only, a typed tag carries its
 * schema gear in the header, and an untyped tag offers "Create a collection"
 * in their place (TDR 0005) — the entry point that used to hide behind the
 * sidebar's hover gear.
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
  // The Collection view exists only while the routed tag has a type (TDR
  // 0005); everywhere else a stored 'table' renders as 'list' — never a
  // broken surface.
  const tagType = useTagType(tag)
  const collectionAvailable = tag !== null && tagType !== null && tagType !== undefined
  const tagKey = tag === null ? null : foldTag(tag)
  // The persisted per-tag view preferences: active layout, sort, board
  // grouping, and the table's column layout — see use-collection-view-settings.
  const {
    boardProperties,
    boardGroupProperty,
    boardAvailable,
    calendarDateProperty,
    calendarAvailable,
    view,
    setViewMode,
    collectionView,
    collectionSort,
    setCollectionSort,
    setCollectionGroup,
    tableGroupProperty,
    tableGroupProperties,
    setTableGroup,
    hiddenColumns,
    columnWidths,
    visibleTagType,
    setColumnWidth,
    toggleColumnHidden,
  } = useCollectionViewSettings(tagKey, collectionAvailable ? tagType : null)
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
  // The grid isn't a collection view, but on a typed tag its cards carry
  // property chips — so the projection loads there too (Plan 28 slice 2).
  const collectionWanted = collectionView || (view === 'grid' && collectionAvailable)
  const collection = useCollection(collectionWanted ? tag : null, collectionSort)
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

  // The table's row shelves (Plan 29 V1b), computed here — not in the table
  // — so the selection's flat order below reads off the same grouping.
  const tableGroups = useMemo(
    () =>
      view === 'table' && tableGroupProperty !== null && filteredCollection !== undefined
        ? tableGroupRows(filteredCollection, tableGroupProperty)
        : null,
    [view, tableGroupProperty, filteredCollection],
  )

  // Saved views: named bundles of mode + sort + grouping + filters, per tag.
  const { savedViews, saveCurrentView, deleteSavedView, applySavedView } = useCollectionSavedViews({
    tagKey,
    view,
    collectionSort,
    boardGroupProperty,
    tableGroupProperty,
    collectionFilters,
    setViewMode,
    setCollectionSort,
    setCollectionGroup,
    setTableGroup,
    setCollectionFilters,
  })
  const ready = notes !== undefined
  const { onScroll } = useScrollRestoration(scrollElement, ready)

  // The flat, render-order paths the selection and its shortcuts act on —
  // the collection's own order while the table view sorts by a property.
  const orderedPaths = useMemo(
    () =>
      tableGroups !== null
        ? tableGroups.flatMap((group) => group.entries.map((entry) => entry.path))
        : collectionView
          ? (filteredCollection ?? []).map((entry) => entry.path)
          : (notes ?? []).map((note) => note.path),
    [tableGroups, collectionView, filteredCollection, notes],
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
      aria-label={tag === null ? 'All notes' : `#${tag}`}
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
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 py-5 pl-12 pr-7">
        {tag === null ? (
          <h1 className="app-page-title text-text">Notes</h1>
        ) : (
          <TagPageTitle
            tag={tag}
            typed={collectionAvailable}
            onBack={() => handleFilterSelect(null)}
            onConfigure={() => setEditingSchema(true)}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {tag === null ? (
            <AllNotesFilters tag={tag} facets={facets ?? []} onSelect={handleFilterSelect} />
          ) : null}
          {view === 'table' && tableGroupProperties.length > 0 ? (
            <Select
              value={tableGroupProperty?.key ?? '__none'}
              items={{
                __none: 'No grouping',
                ...Object.fromEntries(
                  tableGroupProperties.map((property) => [property.key, property.name]),
                ),
              }}
              onValueChange={(value) => {
                if (typeof value === 'string' && value !== '') {
                  setTableGroup(value === '__none' ? null : value)
                }
              }}
            >
              <SelectTrigger aria-label="Group by" data-size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No grouping</SelectItem>
                {tableGroupProperties.map((property) => (
                  <SelectItem key={property.key} value={property.key}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
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
                    className="app-icon-button text-text-muted hover:text-text"
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
                className="app-icon-button text-text-muted hover:text-text"
              >
                <Download aria-hidden className="size-3.5" />
              </button>
            </>
          ) : null}
          {tag !== null && tagType === null ? (
            // The untyped tag page's one call to action (TDR 0005): give the
            // tag a schema and the collection views light up. `undefined`
            // (type still loading) keeps it hidden — no flash on typed tags.
            <button
              type="button"
              onClick={() => setEditingSchema(true)}
              className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent-soft-text transition-opacity hover:opacity-80"
            >
              <Layers aria-hidden className="size-3.5" />
              Create a collection
            </button>
          ) : null}
          <div
            role="group"
            aria-label="Layout"
            className="flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
          >
            {(
              [
                // On a typed tag the collection table IS the page's table
                // (see use-collection-view-settings), so the plain list view
                // is not offered beside it.
                { mode: 'list', label: 'List view', Glyph: List, available: !collectionAvailable },
                { mode: 'grid', label: 'Grid view', Glyph: LayoutGrid, available: true },
                {
                  mode: 'table',
                  label: 'Collection view',
                  Glyph: Layers,
                  available: collectionAvailable,
                },
                {
                  mode: 'board',
                  label: 'Board view',
                  Glyph: LayoutTemplate,
                  available: boardAvailable,
                },
                {
                  mode: 'calendar',
                  label: 'Calendar view',
                  Glyph: Calendar,
                  available: calendarAvailable,
                },
              ] as const
            ).map(({ mode, label, Glyph, available }) =>
              available ? (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  aria-pressed={view === mode}
                  onClick={() => {
                    setViewMode(mode)
                  }}
                  className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                    view === mode
                      ? 'bg-surface text-text shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  <Glyph aria-hidden className="size-3.5" />
                </button>
              ) : null,
            )}
          </div>
          <NewNoteButton tag={tag} />
        </div>
      </header>
      {/* One context menu for the whole list — rows and cards carry
          data-note-path; the menu resolves the note from the click. It wraps
          the scroll container from OUTSIDE: its wrappers are display:contents,
          and the table's virtualizer measures its direct parent — a wrapper
          between the two would hand it a zero-height viewport. The positioned
          wrapper here sits outside that pair, anchoring the scroll veil to
          the container's top edge. */}
      <div className="relative min-h-0 flex-1">
        <NoteListContextMenu>
          <div
            ref={setScrollElement}
            data-testid="all-notes-scroll"
            onScroll={onScroll}
            className="h-full overflow-auto"
          >
            {view === 'grid' ? (
              <AllNotesGrid
                notes={notes}
                tag={tag}
                type={collectionAvailable ? tagType : null}
                entries={collectionAvailable ? filteredCollection : undefined}
                onOpen={openNote}
              />
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
                groups={tableGroups}
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
        {/* Board and calendar scroll inside their own columns, and the
            list/table views pin a glass header row instead — the melt at the
            container's top edge belongs to the grid alone. */}
        {view === 'grid' ? <ScrollVeil scrollElement={scrollElement} /> : null}
      </div>

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
