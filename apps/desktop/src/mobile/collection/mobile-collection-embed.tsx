import { useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  CollectionEmbed,
  CollectionEmbedView,
  CollectionEntry,
  TagProperty,
  TagType,
} from '@kore/core'
import { boardColumns } from '@/components/all-notes/collection-board'
import { entriesByDate } from '@/components/all-notes/collection-calendar'
import { CardPropertyChips } from '@/components/all-notes/card-property-chips'
import {
  BoardView,
  Calendar,
  ChevronRight,
  LayoutGrid,
  Sliders,
  TableView,
  Trash,
  type Icon,
} from '@/components/icons'
import { TagIcon } from '@/components/tags/tag-icon'
import { formatShortDate, todayIso } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { useFirstImages } from '@/mobile/note-card-grid'
import { useSlidingIndicator } from '@/mobile/use-sliding-indicator'
import { useSettings } from '@/providers/settings-provider'
import { GalleryCard } from './mobile-gallery'
import { MobileCollectionTable } from './mobile-collection-table'
import { MobileViewOptions, type ViewGrouping } from './mobile-view-options'

/** Rows (or cards, or lane cards) shown before "Show all": the note stays a note. */
export const EMBED_PREVIEW_ROWS = 8
/** Cards per board lane before the lane says how many more it holds. */
const LANE_PREVIEW = 4

const VIEW_GLYPH: Record<CollectionEmbedView, Icon> = {
  table: TableView,
  board: BoardView,
  calendar: Calendar,
  grid: LayoutGrid,
}
const VIEW_LABEL: Record<CollectionEmbedView, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  grid: 'Grid',
}
const VIEW_ORDER: readonly CollectionEmbedView[] = ['table', 'board', 'calendar', 'grid']

export interface MobileCollectionEmbedProps {
  /** The fence: its view, filters, sort, group and hidden fields. */
  embed: CollectionEmbed
  /** Rewrite the fence (absent: a read-only view, no controls). */
  onChange?: ((embed: CollectionEmbed) => void) | undefined
  onRemove?: (() => void) | undefined
  /** The collection's name in the header. */
  title: string
  /** The type's icon (a tag collection), when it has one. */
  icon?: string | undefined
  /** The rows the fence shows (filters applied); `undefined` while loading. */
  entries: readonly CollectionEntry[] | undefined
  /** Every row, for the filter pages' value lists. */
  unfiltered: readonly CollectionEntry[] | undefined
  /** The full schema (filters and sorts reach hidden fields too). */
  type: TagType
  /** The table's single-valued groupables. */
  groupProperties: readonly TagProperty[]
  /** The board's lane fields. */
  boardProperties: readonly TagProperty[]
  /** The date field the calendar places by, `null` when there is none. */
  dateProperty: TagProperty | null
  onOpen: (path: string) => void
  /** Open the whole collection (the type's page); absent: "Show all" expands in place. */
  onOpenAll?: (() => void) | undefined
  /** Create a row from the table's "New" row. */
  onCreate?: ((title: string) => Promise<void>) | undefined
}

/**
 * A collection fence inside a note on a phone (Craft's inline collection):
 * a card with the collection's name and count, a layout switch, and a short
 * preview in the fence's own layout. The note keeps scrolling as one page:
 * the table scrolls only sideways, a board's lanes and a gallery's cards
 * scroll sideways too, and the calendar reads as the next dated notes.
 * Past a few rows "Show all" opens the type's page. The options sheet edits
 * the fence itself (filter, sort, group, hidden fields), so the Mac renders
 * the same view from the same markdown.
 */
export function MobileCollectionEmbed({
  embed,
  onChange,
  onRemove,
  title,
  icon,
  entries,
  unfiltered,
  type,
  groupProperties,
  boardProperties,
  dateProperty,
  onOpen,
  onOpenAll,
  onCreate,
}: MobileCollectionEmbedProps): ReactElement {
  const [adjusting, setAdjusting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const hidden = useMemo(() => new Set(embed.hidden ?? []), [embed.hidden])
  const visibleType = useMemo(
    () => ({ properties: type.properties.filter((property) => !hidden.has(property.key)) }),
    [type, hidden],
  )
  const boardProperty =
    boardProperties.find((property) => property.key === embed.group) ?? boardProperties[0] ?? null
  const tableGroup = groupProperties.find((property) => property.key === embed.group) ?? null
  const layouts = VIEW_ORDER.filter(
    (view) =>
      (view !== 'board' || boardProperty !== null) &&
      (view !== 'calendar' || dateProperty !== null),
  )
  const view: CollectionEmbedView = layouts.includes(embed.view) ? embed.view : 'table'
  const rows = entries ?? []
  const limit = expanded ? rows.length : EMBED_PREVIEW_ROWS
  const preview = rows.slice(0, limit)
  const more = rows.length - preview.length

  const setView = (next: CollectionEmbedView): void => {
    hapticImpactLight()
    onChange?.({
      ...embed,
      view: next,
      group: next === 'board' ? (boardProperty?.key ?? null) : embed.group,
    })
  }
  const grouping: ViewGrouping | null =
    view === 'table'
      ? {
          properties: groupProperties,
          selected: tableGroup,
          allowNone: true,
          onChange: (key) => onChange?.({ ...embed, group: key }),
        }
      : view === 'board'
        ? {
            properties: boardProperties,
            selected: boardProperty,
            allowNone: false,
            onChange: (key) => onChange?.({ ...embed, group: key }),
          }
        : null
  const lensActive = embed.filters.length > 0 || embed.sorts.length > 0

  return (
    <section
      aria-label={`Collection ${title}`}
      data-testid="collection-embed"
      data-collection-view={view}
      className="my-5 min-w-0 overflow-hidden rounded-2xl border border-border bg-background"
    >
      <header className="flex items-center gap-2 pt-2 pr-1.5 pl-3.5">
        <button
          type="button"
          onClick={onOpenAll}
          disabled={onOpenAll === undefined}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 text-left active:opacity-60 disabled:active:opacity-100"
        >
          <TagIcon
            icon={icon}
            className="size-[18px] text-text-muted"
            emojiClassName="text-[17px]"
          />
          <span className="truncate text-[16px] font-semibold text-text">{title}</span>
          {entries !== undefined ? (
            <span className="shrink-0 text-[14px] tabular-nums text-text-muted">{rows.length}</span>
          ) : null}
          {onOpenAll !== undefined ? (
            <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
          ) : null}
        </button>
        {onChange !== undefined ? (
          <button
            type="button"
            aria-label={
              embed.filters.length > 0
                ? `View options, ${embed.filters.length} ${embed.filters.length === 1 ? 'filter' : 'filters'}`
                : 'View options'
            }
            aria-haspopup="dialog"
            onClick={() => {
              hapticImpactLight()
              setAdjusting(true)
            }}
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full',
              lensActive ? 'text-accent-soft-text' : 'text-text-muted',
              'active:bg-surface-hover',
            )}
          >
            <Sliders aria-hidden className="size-[18px]" />
          </button>
        ) : null}
        {onRemove !== undefined ? (
          <button
            type="button"
            aria-label="Remove collection from note"
            onClick={onRemove}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-text-muted active:bg-surface-hover"
          >
            <Trash aria-hidden className="size-[18px]" />
          </button>
        ) : null}
      </header>
      {onChange !== undefined && layouts.length > 1 ? (
        <div className="px-3 pb-2">
          <EmbedViewToggle view={view} layouts={layouts} onChange={setView} />
        </div>
      ) : null}

      {entries === undefined ? (
        <div className="px-3.5 py-6 text-[14px] text-text-muted">Loading collection…</div>
      ) : rows.length === 0 ? (
        <div className="px-3.5 pt-2 pb-5 text-[14px] text-text-muted">
          {embed.filters.length > 0 ? 'No notes match this view.' : 'No notes yet.'}
        </div>
      ) : view === 'board' && boardProperty !== null ? (
        <EmbedBoard entries={rows} property={boardProperty} type={visibleType} onOpen={onOpen} />
      ) : view === 'grid' ? (
        <EmbedGallery entries={preview} type={visibleType} onOpen={onOpen} />
      ) : view === 'calendar' && dateProperty !== null ? (
        <EmbedAgenda
          entries={rows}
          property={dateProperty}
          type={visibleType}
          limit={limit}
          onOpen={onOpen}
        />
      ) : (
        <div className="pb-1">
          <MobileCollectionTable
            embedded
            entries={preview}
            type={visibleType}
            groupProperty={tableGroup}
            sorts={embed.sorts}
            onSortChange={
              onChange === undefined
                ? undefined
                : (sorts) => onChange({ ...embed, sorts: [...sorts] })
            }
            label={title}
            onOpen={onOpen}
            onCreate={more > 0 ? undefined : onCreate}
          />
        </div>
      )}

      {entries !== undefined && more > 0 && view !== 'board' && view !== 'calendar' ? (
        <button
          type="button"
          onClick={() => {
            hapticImpactLight()
            if (onOpenAll === undefined) {
              setExpanded(true)
            } else {
              onOpenAll()
            }
          }}
          className="flex h-11 w-full items-center gap-1 border-t border-border/60 px-3.5 text-[14px] font-medium text-primary active:bg-surface-hover"
        >
          Show all {rows.length}
          <ChevronRight aria-hidden className="size-4" />
        </button>
      ) : null}

      {onChange !== undefined ? (
        <MobileViewOptions
          open={adjusting}
          onOpenChange={setAdjusting}
          viewName={title}
          scope="note"
          layout={view === 'grid' ? 'gallery' : view}
          type={type}
          entries={unfiltered}
          filters={embed.filters}
          onFiltersChange={(filters) => onChange({ ...embed, filters })}
          match={embed.match}
          onMatchChange={(match) => onChange({ ...embed, match })}
          sorts={embed.sorts}
          onSortsChange={(sorts) => onChange({ ...embed, sorts: [...sorts] })}
          grouping={grouping}
          hiddenFields={hidden}
          onToggleField={(key) => {
            const next = hidden.has(key)
              ? [...hidden].filter((entry) => entry !== key)
              : [...hidden, key]
            const { hidden: _drop, ...rest } = embed
            onChange(next.length === 0 ? rest : { ...rest, hidden: next })
          }}
        />
      ) : null}
    </section>
  )
}

function EmbedViewToggle({
  view,
  layouts,
  onChange,
}: {
  view: CollectionEmbedView
  layouts: readonly CollectionEmbedView[]
  onChange: (view: CollectionEmbedView) => void
}): ReactElement {
  const controlRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  useSlidingIndicator(controlRef, indicatorRef, view)
  return (
    <div
      ref={controlRef}
      role="group"
      aria-label="Layout"
      className="relative inline-flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
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
              "relative z-20 flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] transition-colors duration-150 motion-reduce:transition-none",
              view === entry ? 'text-text' : 'text-text-muted',
            )}
          >
            <Glyph aria-hidden className="size-4" />
            {view === entry ? VIEW_LABEL[entry] : null}
          </button>
        )
      })}
    </div>
  )
}

/** The board as sideways lanes: each lane's first cards, then how many more. */
function EmbedBoard({
  entries,
  property,
  type,
  onOpen,
}: {
  entries: readonly CollectionEntry[]
  property: TagProperty
  type: TagType
  onOpen: (path: string) => void
}): ReactElement {
  const lanes = useMemo(() => boardColumns(entries, property), [entries, property])
  const chipType = useMemo(
    () => ({ properties: type.properties.filter((entry) => entry.key !== property.key) }),
    [type, property.key],
  )
  return (
    <div
      data-base-ui-swipe-ignore
      className="flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto overscroll-x-contain px-3 pb-3"
    >
      {lanes.map((lane) => (
        <section
          key={lane.label}
          aria-label={`${lane.label}, ${lane.entries.length}`}
          className="flex w-[15.5rem] shrink-0 snap-start flex-col gap-2 rounded-xl bg-surface-hover/60 p-2"
        >
          <div className="flex h-7 items-center gap-2 px-1">
            <span
              aria-hidden
              className={cn('size-2 shrink-0 rounded-full', lane.color ?? 'bg-text-muted/40')}
            />
            <span className="truncate text-[13px] font-semibold text-text">{lane.label}</span>
            <span className="text-[13px] tabular-nums text-text-muted">{lane.entries.length}</span>
          </div>
          {lane.entries.slice(0, LANE_PREVIEW).map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => onOpen(entry.path)}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5 text-left shadow-sm active:bg-surface-hover"
            >
              <span className="line-clamp-2 text-[14px] font-medium leading-snug text-text">
                {entry.title}
              </span>
              <CardPropertyChips type={chipType} entry={entry} />
            </button>
          ))}
          {lane.entries.length > LANE_PREVIEW ? (
            <div className="px-1 pb-0.5 text-[12px] text-text-muted">
              +{lane.entries.length - LANE_PREVIEW} more
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

/** The gallery as a sideways strip of cover cards. */
function EmbedGallery({
  entries,
  type,
  onOpen,
}: {
  entries: readonly CollectionEntry[]
  type: TagType
  onOpen: (path: string) => void
}): ReactElement {
  const covers = useFirstImages(entries.map((entry) => entry.path))
  return (
    <div
      data-base-ui-swipe-ignore
      className="flex snap-x snap-mandatory scroll-px-3 items-start gap-2.5 overflow-x-auto overscroll-x-contain px-3 pb-1"
    >
      {entries.map((entry) => (
        <div key={entry.path} className="w-[10.5rem] shrink-0 snap-start">
          <GalleryCard entry={entry} type={type} cover={covers.get(entry.path)} onOpen={onOpen} />
        </div>
      ))}
    </div>
  )
}

/** The calendar inline: the next dated notes from today, each beside its date. */
function EmbedAgenda({
  entries,
  property,
  type,
  limit,
  onOpen,
}: {
  entries: readonly CollectionEntry[]
  property: TagProperty
  type: TagType
  limit: number
  onOpen: (path: string) => void
}): ReactElement {
  const { settings } = useSettings()
  const [today] = useState(() => todayIso())
  const upcoming = useMemo(() => {
    const byDate = entriesByDate(entries, property)
    return [...byDate]
      .filter(([date]) => date >= today)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([date, list]) => list.map((entry) => ({ date, entry })))
  }, [entries, property, today])
  const chipType = useMemo(
    () => ({ properties: type.properties.filter((entry) => entry.key !== property.key) }),
    [type, property.key],
  )
  if (upcoming.length === 0) {
    return (
      <div className="px-3.5 pt-1 pb-5 text-[14px] text-text-muted">
        Nothing on the calendar from today on.
      </div>
    )
  }
  return (
    <ol className="flex flex-col px-1.5 pb-2">
      {upcoming.slice(0, limit).map(({ date, entry }) => (
        <li key={`${date}:${entry.path}`}>
          <button
            type="button"
            onClick={() => onOpen(entry.path)}
            className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left active:bg-surface-hover"
          >
            <span
              className={cn(
                'mt-0.5 w-14 shrink-0 text-[13px] font-medium tabular-nums',
                date === today ? 'text-primary' : 'text-text-muted',
              )}
            >
              {date === today ? 'Today' : formatShortDate(date, settings.dateFormat)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[15px] font-medium text-text">{entry.title}</span>
              <CardPropertyChips type={chipType} entry={entry} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
