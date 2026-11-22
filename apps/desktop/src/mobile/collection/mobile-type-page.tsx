import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  EMPTY_TAG_TYPE,
  errorMessage,
  foldTag,
  tagDisplayName,
  type SavedCollectionView,
  type TagType,
  type TimelineZoom,
} from '@kore/core'
import { applyCollectionFilters } from '@/components/all-notes/collection-filter-menu'
import type {
  CollectionFilter,
  CollectionFilterMatch,
} from '@/components/all-notes/collection-filter-menu'
import {
  useCollectionSavedViews,
  useCollectionViewSettings,
} from '@/components/all-notes/use-collection-view-settings'
import { LIVE_COLLECTION_VIEW_ID } from '@/components/all-notes/collection-view-model'
import { ChevronDown, ChevronLeft, Search, Settings, Sliders } from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { timelineFieldsOf } from '@/lib/tags/timeline-layout'
import { TagIcon } from '@/components/tags/tag-icon'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { useCollection } from '@/hooks/use-collection'
import { useTagType } from '@/hooks/use-tag-type'
import { useTemplateValues } from '@/hooks/use-template-values'
import { createTitledCollectionNote } from '@/lib/tags/create-collection-note'
import { cn } from '@/lib/utils'
import { MobileBoard } from '@/mobile/collection/mobile-board'
import { hapticImpactLight } from '@/mobile/haptics'
import { SearchInput } from '@/mobile/search-input'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { MobileCalendar } from './mobile-calendar'
import { MobileTimeline } from './mobile-timeline'
import { MobileCollectionTable } from './mobile-collection-table'
import { MobileGallery } from './mobile-gallery'
import { MobileViewOptions, type ViewGrouping } from './mobile-view-options'
import { MOBILE_VIEW_GLYPH, MOBILE_VIEW_LABEL, MobileViewsSheet } from './mobile-views-sheet'
import { availableTypeViews, mobileTypeView, rowsMatchingTitle } from './mobile-type-view'

/** Stable empty list for a type whose definition stores no views. */
const NO_TYPE_VIEWS: readonly SavedCollectionView[] = []

interface MobileTypePageProps {
  /** The routed tag (display casing). */
  tag: string
}

/**
 * A type's page on the phone (TDR 0005; Craft's collection page): the type's
 * icon and name, its saved views (the same `views:` the Mac writes into the
 * type file, so a view made on one device opens on the other), and the
 * collection as a table, a board, or a gallery. A saved view's sort and
 * filters apply here as they do on the Mac, so the same view shows the same
 * rows. The search narrows by title; the gear opens the type's fields.
 */
export function MobileTypePage({ tag }: MobileTypePageProps): ReactElement {
  const { graph } = useGraph()
  const { navigate, back } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const tagKey = foldTag(tag)
  // Every tag is a collection: no definition note reads as zero fields.
  const loadedTagType = useTagType(tag)
  const tagType: TagType | undefined = loadedTagType === null ? EMPTY_TAG_TYPE : loadedTagType
  const {
    boardProperties,
    boardGroupProperty,
    boardAvailable,
    calendarAvailable,
    calendarDateProperty,
    view: storedView,
    setViewMode,
    collectionSorts,
    setCollectionSorts,
    setCollectionGroup,
    tableGroupProperty,
    tableGroupProperties,
    setTableGroup,
    hiddenColumns,
    frozenColumns,
    toggleColumnHidden,
    setFrozenColumns,
    visibleTagType,
  } = useCollectionViewSettings(tagKey, tagType ?? null)
  const collection = useCollection(tag, collectionSorts)
  // Filters live in the saved view (like the Mac's tab): the View options
  // sheet edits them and the saved-views hook writes them back.
  const [collectionFilters, setCollectionFilters] = useState<CollectionFilter[]>([])
  const [filterMatch, setFilterMatch] = useState<CollectionFilterMatch>('all')
  const {
    tabs,
    activeViewId,
    applySavedView,
    addView,
    deleteSavedView,
    renameSavedView,
    setSavedViewLayout,
    updateActiveTimeline,
  } = useCollectionSavedViews({
    tagKey,
    typeViews:
      loadedTagType === undefined || loadedTagType === null
        ? loadedTagType
        : (loadedTagType.views ?? NO_TYPE_VIEWS),
    view: storedView,
    collectionSorts,
    boardGroupProperty,
    tableGroupProperty,
    calendarAvailable,
    collectionFilters,
    filterMatch,
    setViewMode,
    setCollectionSorts,
    setCollectionGroup,
    setTableGroup,
    setCollectionFilters,
    setFilterMatch,
  })
  const activeTab = tabs.find((entry) => entry.id === activeViewId) ?? tabs[0]
  // The timeline's fields and zoom ride on its saved tab, as on the Mac.
  const [liveTimelineZoom, setLiveTimelineZoom] = useState<TimelineZoom>('month')
  const timelineZoom =
    activeViewId === LIVE_COLLECTION_VIEW_ID ? liveTimelineZoom : (activeTab?.zoom ?? 'month')
  const setTimelineZoom = (zoom: TimelineZoom): void => {
    if (activeViewId === LIVE_COLLECTION_VIEW_ID) {
      setLiveTimelineZoom(zoom)
    } else {
      updateActiveTimeline({ zoom })
    }
  }
  const timelineFields = useMemo(
    () =>
      tagType === undefined
        ? null
        : timelineFieldsOf(tagType.properties, { start: activeTab?.start, end: activeTab?.end }),
    [tagType, activeTab?.start, activeTab?.end],
  )

  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const rows = useMemo(() => {
    if (collection === undefined || tagType === undefined) {
      return
    }
    return rowsMatchingTitle(
      applyCollectionFilters(tagType, collection, collectionFilters, filterMatch),
      deferredQuery,
    )
  }, [collection, tagType, collectionFilters, filterMatch, deferredQuery])

  const view = mobileTypeView(storedView)
  const layouts = availableTypeViews({ boardAvailable, calendarAvailable })
  const ActiveViewGlyph = MOBILE_VIEW_GLYPH[view]

  const [choosingView, setChoosingView] = useState(false)
  const [adjustingView, setAdjustingView] = useState(false)
  const grouping: ViewGrouping | null =
    view === 'table' || view === 'timeline'
      ? {
          properties: tableGroupProperties,
          selected: tableGroupProperty,
          allowNone: true,
          onChange: setTableGroup,
        }
      : view === 'board'
        ? {
            properties: boardProperties,
            selected: boardGroupProperty,
            allowNone: false,
            onChange: (key) => {
              if (key !== null) {
                setCollectionGroup(key)
              }
            },
          }
        : null
  // The options button lights up while the view narrows, orders or groups
  // the rows, so a lens left on never hides behind a plain icon.
  const lensActive =
    collectionFilters.length > 0 ||
    collectionSorts.length > 0 ||
    ((view === 'table' || view === 'timeline') && tableGroupProperty !== null)
  const [configuring, setConfiguring] = useState(false)
  const resolveTemplateValues = useTemplateValues()
  const createRow = useCallback(
    async (title: string) => {
      if (graph === null || tagType === undefined) {
        return
      }
      try {
        await createTitledCollectionNote(
          tag,
          graph.generation,
          title,
          tagType,
          await resolveTemplateValues(null),
        )
      } catch (error) {
        toast.add({
          type: 'error',
          title: "Couldn't create the note",
          description: errorMessage(error),
        })
      }
    },
    [graph, tag, tagType, resolveTemplateValues],
  )
  const open = (path: string): void => navigate(routeForPath(path))

  const name = tagDisplayName(tag)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // The field appears because the search button was tapped: take the keyboard.
  useEffect(() => {
    if (searching) {
      searchInputRef.current?.focus()
    }
  }, [searching])
  const closeSearch = (): void => {
    setSearching(false)
    setQuery('')
  }

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <header
        ref={barRef}
        className="mobile-glass-bar absolute inset-x-0 top-0 z-30 px-4 pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)' }}
      >
        {searching ? (
          <div className="flex h-11 items-center gap-2">
            <SearchInput
              ref={searchInputRef}
              placeholder={`Search ${name}`}
              aria-label={`Search ${name}`}
              value={query}
              onValueChange={setQuery}
            />
            <button
              type="button"
              onClick={closeSearch}
              className="h-11 shrink-0 px-1 text-[15px] font-medium text-primary active:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex h-11 items-center">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 size-11 shrink-0"
              aria-label="Back"
              onClick={back}
            >
              <ChevronLeft />
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label={`Search ${name}`}
              onClick={() => setSearching(true)}
            >
              <Search />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 size-11 shrink-0"
              aria-label={`Configure #${tagKey}`}
              onClick={() => setConfiguring(true)}
            >
              <Settings />
            </Button>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2.5 pt-1">
          <TagIcon
            icon={loadedTagType?.icon}
            className="size-6 text-text-muted"
            emojiClassName="text-[24px]"
          />
          <h1 className="min-w-0 truncate text-[28px] font-semibold tracking-tight">{name}</h1>
          {rows !== undefined ? (
            <span className="shrink-0 pt-1.5 text-[15px] tabular-nums text-text-muted">
              {rows.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              hapticImpactLight()
              setChoosingView(true)
            }}
            aria-label={`View: ${activeTab?.name ?? MOBILE_VIEW_LABEL[view]}`}
            aria-haspopup="dialog"
            className="relative flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-surface-hover pr-2.5 pl-3 text-[14px] font-medium text-text before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] active:bg-surface-active"
          >
            <ActiveViewGlyph aria-hidden className="size-4 shrink-0 text-text-muted" />
            <span className="truncate">{activeTab?.name ?? MOBILE_VIEW_LABEL[view]}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-text-muted" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              hapticImpactLight()
              setAdjustingView(true)
            }}
            aria-label={
              collectionFilters.length > 0
                ? `View options, ${collectionFilters.length} ${collectionFilters.length === 1 ? 'filter' : 'filters'}`
                : 'View options'
            }
            aria-haspopup="dialog"
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-1 rounded-full before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] transition-colors",
              collectionFilters.length > 0 ? 'pr-3 pl-2.5' : 'w-9 justify-center',
              lensActive
                ? 'bg-accent-soft text-accent-soft-text'
                : 'bg-surface-hover text-text-muted active:bg-surface-active',
            )}
          >
            <Sliders aria-hidden className="size-[18px]" />
            {collectionFilters.length > 0 ? (
              <span className="text-[13px] font-semibold tabular-nums">
                {collectionFilters.length}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {rows === undefined || tagType === undefined || visibleTagType === null ? (
        <div
          className="flex flex-1 items-center justify-center"
          style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
          aria-label="Loading notes"
        >
          <Spinner className="size-5 text-text-muted" />
        </div>
      ) : view === 'board' && boardGroupProperty !== null ? (
        <MobileBoard
          entries={rows}
          tag={tag}
          type={tagType}
          property={boardGroupProperty}
          groupProperties={boardProperties}
          onGroupChange={setCollectionGroup}
          onOpen={open}
        />
      ) : view === 'calendar' && calendarDateProperty !== null ? (
        <MobileCalendar
          entries={rows}
          property={calendarDateProperty}
          tag={tag}
          type={tagType}
          cardType={visibleTagType}
          onOpen={open}
        />
      ) : view === 'timeline' && timelineFields !== null ? (
        <MobileTimeline
          entries={rows}
          fields={timelineFields}
          groupProperty={tableGroupProperty}
          zoom={timelineZoom}
          onZoomChange={setTimelineZoom}
          onOpen={open}
        />
      ) : view === 'gallery' ? (
        rows.length === 0 ? (
          <EmptyRows searching={deferredQuery.trim() !== ''} name={name} />
        ) : (
          <MobileGallery entries={rows} type={visibleTagType} onOpen={open} />
        )
      ) : (
        <MobileCollectionTable
          entries={rows}
          type={visibleTagType}
          groupProperty={tableGroupProperty}
          sorts={collectionSorts}
          onSortChange={setCollectionSorts}
          frozenColumns={frozenColumns}
          label={name}
          onOpen={open}
          onCreate={createRow}
        />
      )}

      <MobileViewsSheet
        open={choosingView}
        onOpenChange={setChoosingView}
        tabs={tabs}
        activeTabId={activeTab?.id}
        layouts={layouts}
        onSelect={applySavedView}
        onAdd={addView}
        onRename={renameSavedView}
        onChangeLayout={setSavedViewLayout}
        onDelete={deleteSavedView}
      />
      {tagType !== undefined ? (
        <MobileViewOptions
          open={adjustingView}
          onOpenChange={setAdjustingView}
          viewName={activeTab?.name ?? MOBILE_VIEW_LABEL[view]}
          layout={view}
          type={tagType}
          entries={collection}
          filters={collectionFilters}
          onFiltersChange={setCollectionFilters}
          match={filterMatch}
          onMatchChange={setFilterMatch}
          sorts={collectionSorts}
          onSortsChange={setCollectionSorts}
          grouping={grouping}
          hiddenFields={hiddenColumns}
          onToggleField={toggleColumnHidden}
          frozenColumns={frozenColumns}
          onFrozenColumnsChange={setFrozenColumns}
        />
      ) : null}
      {configuring ? (
        <TagConfigDialog
          tag={tag}
          onClose={() => setConfiguring(false)}
          onRenamed={(renamed) =>
            navigate({ kind: 'allNotes', filter: { kind: 'tag', tag: renamed } })
          }
        />
      ) : null}
    </div>
  )
}

function EmptyRows({ searching, name }: { searching: boolean; name: string }): ReactElement {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-text-muted"
      style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
    >
      <p className="text-sm">{searching ? 'No matches' : `No ${name} notes yet`}</p>
    </div>
  )
}
