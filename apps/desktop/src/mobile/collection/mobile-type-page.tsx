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
import {
  BoardView,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  LayoutGrid,
  Search,
  Settings,
  Sliders,
  TableView,
  TimelineView,
  type Icon,
} from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { timelineFieldsOf } from '@/lib/tags/timeline-layout'
import { TagIcon } from '@/components/tags/tag-icon'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
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
import { useSlidingIndicator } from '@/mobile/use-sliding-indicator'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { MobileCalendar } from './mobile-calendar'
import { MobileTimeline } from './mobile-timeline'
import { MobileCollectionTable } from './mobile-collection-table'
import { MobileGallery } from './mobile-gallery'
import { MobileViewOptions, type ViewGrouping } from './mobile-view-options'
import {
  availableTypeViews,
  mobileTypeView,
  rowsMatchingTitle,
  storedTypeView,
  type MobileTypeView,
} from './mobile-type-view'

/** Stable empty list for a type whose definition stores no views. */
const NO_TYPE_VIEWS: readonly SavedCollectionView[] = []

const VIEW_GLYPH: Record<MobileTypeView, Icon> = {
  table: TableView,
  board: BoardView,
  calendar: Calendar,
  timeline: TimelineView,
  gallery: LayoutGrid,
}

const VIEW_LABEL: Record<MobileTypeView, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  timeline: 'Timeline',
  gallery: 'Grid',
}

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
    toggleColumnHidden,
    visibleTagType,
  } = useCollectionViewSettings(tagKey, tagType ?? null)
  const collection = useCollection(tag, collectionSorts)
  // Filters live in the saved view (like the Mac's tab): the View options
  // sheet edits them and the saved-views hook writes them back.
  const [collectionFilters, setCollectionFilters] = useState<CollectionFilter[]>([])
  const [filterMatch, setFilterMatch] = useState<CollectionFilterMatch>('all')
  const { tabs, activeViewId, applySavedView, addView, updateActiveTimeline } =
    useCollectionSavedViews({
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
  const setView = (next: MobileTypeView): void => {
    hapticImpactLight()
    setViewMode(storedTypeView(next))
  }

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
            onClick={() => setChoosingView(true)}
            aria-label={`View: ${activeTab?.name ?? VIEW_LABEL[view]}`}
            aria-haspopup="dialog"
            className="relative flex h-9 min-w-0 items-center gap-1.5 rounded-full before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] bg-surface-hover pr-2.5 pl-3.5 text-[14px] font-medium text-text active:bg-surface-active"
          >
            <span className="truncate">{activeTab?.name ?? VIEW_LABEL[view]}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-text-muted" />
          </button>
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
          <div className="flex-1" />
          <TypeViewToggle view={view} layouts={layouts} onChange={setView} />
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
          label={name}
          onOpen={open}
          onCreate={createRow}
        />
      )}

      <Drawer open={choosingView} onOpenChange={setChoosingView}>
        <DrawerContent>
          <DrawerTitle>Views</DrawerTitle>
          <DrawerBody className="px-4 pb-2">
            <div role="listbox" aria-label="Saved views" className="flex flex-col">
              {tabs.map((entry) => {
                const Glyph = VIEW_GLYPH[mobileTypeView(entry.view)]
                const selected = entry.id === activeTab?.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      hapticImpactLight()
                      applySavedView(entry)
                      setChoosingView(false)
                    }}
                    className="flex h-12 items-center gap-3 rounded-xl px-2 text-left text-base active:bg-surface-hover"
                  >
                    <Glyph aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                    <span className={cn('min-w-0 flex-1 truncate', selected && 'font-medium')}>
                      {entry.name}
                    </span>
                    {selected ? <Check aria-hidden className="size-4 text-primary" /> : null}
                  </button>
                )
              })}
            </div>
            <p className="px-2 pt-4 pb-1 text-[13px] text-text-muted">New view</p>
            <div className="flex flex-col">
              {layouts.map((entry) => {
                const Glyph = VIEW_GLYPH[entry]
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => {
                      hapticImpactLight()
                      addView(storedTypeView(entry))
                      setChoosingView(false)
                    }}
                    className="flex h-12 items-center gap-3 rounded-xl px-2 text-left text-base active:bg-surface-hover"
                  >
                    <Glyph aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate">{VIEW_LABEL[entry]}</span>
                  </button>
                )
              })}
            </div>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
      {tagType !== undefined ? (
        <MobileViewOptions
          open={adjustingView}
          onOpenChange={setAdjustingView}
          viewName={activeTab?.name ?? VIEW_LABEL[view]}
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

interface TypeViewToggleProps {
  view: MobileTypeView
  /** The layouts this type can show. */
  layouts: readonly MobileTypeView[]
  onChange: (view: MobileTypeView) => void
}

/** Table / Board / Calendar / Grid: the page's layout, one tap each. */
function TypeViewToggle({ view, layouts, onChange }: TypeViewToggleProps): ReactElement {
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
      {layouts.map((entry) => {
        const Glyph = VIEW_GLYPH[entry]
        return (
          <button
            key={entry}
            type="button"
            data-sliding-value={entry}
            aria-label={`${VIEW_LABEL[entry]} view`}
            aria-pressed={view === entry}
            onClick={() => onChange(entry)}
            className={cn(
              "relative z-20 flex h-9 items-center before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none",
              // Five layouts (a dated type) still leave the view's name room.
              layouts.length > 4 ? 'w-9' : 'w-11',
              view === entry ? 'text-text' : 'text-text-muted',
            )}
          >
            <Glyph aria-hidden className="size-[18px]" />
          </button>
        )
      })}
    </div>
  )
}
