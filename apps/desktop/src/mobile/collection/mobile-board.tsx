import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { CollectionEntry, TagProperty, TagType } from '@kore/core'
import { CardPropertyChips } from '@/components/all-notes/card-property-chips'
import {
  boardColumns,
  overlayValue,
  type BoardColumn,
} from '@/components/all-notes/collection-board'
import { CollectionTaskBadge } from '@/components/all-notes/collection-task-badge'
import { Check, ChevronDown, Note, Plus } from '@/components/icons'
import { selectOptionBadgeClass } from '@/components/tags/select-colors'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useOpenTaskCounts } from '@/hooks/use-open-task-counts'
import { useOptimisticMoves } from '@/hooks/use-optimistic-moves'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'
import { useCreateCollectionNote } from '@/lib/tags/use-create-collection-note'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { laneMove } from './board-move'

interface MobileBoardProps {
  /** The collection rows, `undefined` while they load. */
  entries: readonly CollectionEntry[] | undefined
  tag: string
  type: TagType
  /** The grouping property (resolved by the caller). */
  property: TagProperty
  /** Every property the board can group by, schema order. */
  groupProperties: readonly TagProperty[]
  onGroupChange: (key: string) => void
  onOpen: (path: string) => void
}

interface MovingCard {
  entry: CollectionEntry
  from: BoardColumn
}

/**
 * The type's board on a phone (Notion's mobile Kanban): every lane renders
 * side by side in a horizontally snap-scrolling strip (`snap-x snap-mandatory`),
 * with adjacent columns peeking on the left and right edges so swiping across
 * statuses feels natural and spatial. Tall lanes scroll vertically inside their
 * own rounded column; tapping a card opens the note and tapping its move pill
 * opens the target-lane sheet with the same optimistic overlay as desktop.
 */
export function MobileBoard({
  entries,
  tag,
  type,
  property,
  groupProperties,
  onGroupChange,
  onOpen,
}: MobileBoardProps): ReactElement {
  const commitProperties = useCommitNoteProperties()
  const createNote = useCreateCollectionNote(tag, type)
  const { moves, record } = useOptimisticMoves<unknown>(entries)
  const entryPaths = useMemo(() => (entries ?? []).map((entry) => entry.path), [entries])
  const taskCounts = useOpenTaskCounts(entryPaths)
  const [moving, setMoving] = useState<MovingCard | null>(null)
  const [choosingGroup, setChoosingGroup] = useState(false)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLSpanElement | null>(null)

  const effectiveEntries = useMemo(
    () =>
      (entries ?? []).map((entry) => {
        if (!moves.has(entry.path)) {
          return entry
        }
        const properties = { ...entry.properties }
        const moved = overlayValue(moves.get(entry.path))
        if (moved === null) {
          delete properties[property.key]
        } else {
          properties[property.key] = moved
        }
        return { ...entry, properties }
      }),
    [entries, moves, property.key],
  )
  // The card's chips skip the grouped property: the lane header already names it.
  const chipType = useMemo(
    () => ({ ...type, properties: type.properties.filter((p) => p.key !== property.key) }),
    [type, property.key],
  )
  const columns = useMemo(
    () => boardColumns(effectiveEntries, property),
    [effectiveEntries, property],
  )
  const coloredSelect =
    property.type === 'select' || property.type === 'status' || property.type === 'multiselect'

  // Keep the subtle bottom scroll indicator synced directly via DOM transforms
  // so swiping across lanes never triggers React re-renders.
  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) {
      return
    }
    const syncThumb = (): void => {
      const thumb = thumbRef.current
      if (thumb === null) {
        return
      }
      const max = Math.max(0, strip.scrollWidth - strip.clientWidth)
      const ratio = strip.scrollWidth > 0 ? Math.min(1, strip.clientWidth / strip.scrollWidth) : 1
      const progress = max > 0 ? Math.min(1, Math.max(0, strip.scrollLeft / max)) : 0
      const widthPct = Math.max(20, ratio * 100)
      const travelPct = 100 - widthPct
      thumb.style.width = `${widthPct}%`
      thumb.style.transform = `translate3d(${(progress * travelPct * 100) / widthPct}%, 0, 0)`
    }
    syncThumb()
    strip.addEventListener('scroll', syncThumb, { passive: true })
    if (typeof ResizeObserver === 'undefined') {
      return () => strip.removeEventListener('scroll', syncThumb)
    }
    const observer = new ResizeObserver(syncThumb)
    observer.observe(strip)
    return () => {
      strip.removeEventListener('scroll', syncThumb)
      observer.disconnect()
    }
  }, [columns.length])

  const moveTo = (card: MovingCard, to: BoardColumn): void => {
    setMoving(null)
    const move = laneMove(property, card.entry, card.from, to)
    if (move === 'unchanged') {
      return
    }
    haptic('drop')
    record(card.entry.path, move.value)
    commitProperties(card.entry.path, { [property.key]: move.value ?? undefined })
  }

  const createInLane = async (column: BoardColumn): Promise<void> => {
    haptic('action')
    const laneValue =
      property.type === 'multiselect' && typeof column.commit === 'string'
        ? [column.commit]
        : column.commit
    const path = await createNote(laneValue === null ? {} : { [property.key]: laneValue })
    if (path !== null) {
      onOpen(path)
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={{
        paddingTop: 'calc(var(--mobile-header-height, 0px) + 0.5rem)',
        paddingBottom: 'calc(var(--mobile-tab-bar-height, env(safe-area-inset-bottom)) + 0.5rem)',
      }}
    >
      {groupProperties.length > 1 ? (
        <div className="flex shrink-0 items-center px-4 pb-2.5">
          <button
            type="button"
            onClick={() => {
              setChoosingGroup(true)
            }}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-hover px-3 text-[13px] font-medium text-text-secondary active:bg-surface-active"
          >
            <span>{property.name}</span>
            <ChevronDown aria-hidden className="size-3.5 text-text-muted" />
          </button>
        </div>
      ) : null}

      <div
        ref={stripRef}
        aria-label={`${property.name} lanes`}
        data-base-ui-swipe-ignore
        className="flex min-h-0 flex-1 snap-x snap-mandatory items-start gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain px-[max(1rem,calc((100vw-min(78vw,20.5rem))/2))]"
      >
        {columns.map((column) => {
          const pillBadgeClass =
            coloredSelect && column.commit !== null
              ? selectOptionBadgeClass(column.label, property)
              : 'bg-surface-hover text-text-secondary'
          return (
            <section
              key={column.label}
              aria-label={column.label}
              className="flex max-h-full w-[78vw] max-w-[20.5rem] shrink-0 snap-center flex-col overflow-hidden rounded-2xl border border-border bg-surface-sunken/75"
            >
              <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
                <span
                  className={cn(
                    'inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-snug',
                    pillBadgeClass,
                  )}
                >
                  {column.color !== null ? (
                    <span
                      aria-hidden
                      className={cn('size-2 shrink-0 rounded-full', column.color)}
                    />
                  ) : null}
                  <span className="truncate">{column.label}</span>
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-text-muted">
                  {column.entries.length}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  aria-label={`Add in ${column.label}`}
                  onClick={() => void createInLane(column)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-muted active:bg-surface-hover active:text-text"
                >
                  <Plus aria-hidden className="size-4" />
                </button>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain px-2.5 pb-2.5">
                {entries !== undefined && column.entries.length === 0 ? (
                  <p className="px-1 py-4 text-center text-[13px] text-text-muted">
                    Nothing in {column.label}
                  </p>
                ) : (
                  column.entries.map((entry) => (
                    <BoardCard
                      key={entry.path}
                      entry={entry}
                      type={chipType}
                      lane={column}
                      openTasks={taskCounts[entry.path] ?? 0}
                      onOpen={() => onOpen(entry.path)}
                      onMove={() => setMoving({ entry, from: column })}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => void createInLane(column)}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-surface/50 px-3 text-[14px] font-medium text-text-muted active:bg-surface-hover"
                >
                  <Plus aria-hidden className="size-4" />
                  <span>New in {column.label}</span>
                </button>
              </div>
            </section>
          )
        })}
      </div>

      {columns.length > 1 ? (
        <div aria-hidden className="flex shrink-0 justify-center pt-3 pb-1">
          <div className="h-[3px] w-28 overflow-hidden rounded-full bg-surface-hover">
            <span
              ref={thumbRef}
              className="block h-full rounded-full bg-text-muted/60 will-change-transform"
            />
          </div>
        </div>
      ) : null}

      <Drawer open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <DrawerContent>
          <DrawerTitle>Move to</DrawerTitle>
          <DrawerBody className="px-4">
            <OptionList
              options={columns.map((column) => ({
                id: column.label,
                label: column.label,
                color: column.color,
                count: column.entries.length,
              }))}
              selected={moving?.from.label ?? ''}
              onPick={(label) => {
                const to = columns.find((column) => column.label === label)
                if (moving !== null && to !== undefined) {
                  moveTo(moving, to)
                }
              }}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
      <Drawer open={choosingGroup} onOpenChange={setChoosingGroup}>
        <DrawerContent>
          <DrawerTitle>Group by</DrawerTitle>
          <DrawerBody className="px-4">
            <OptionList
              options={groupProperties.map((candidate) => ({
                id: candidate.key,
                label: candidate.name,
                color: null,
                count: null,
              }))}
              selected={property.key}
              onPick={(key) => {
                setChoosingGroup(false)
                onGroupChange(key)
              }}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

interface BoardCardProps {
  entry: CollectionEntry
  type: TagType
  lane: BoardColumn
  openTasks: number
  onOpen: () => void
  onMove: () => void
}

function BoardCard({ entry, type, lane, openTasks, onOpen, onMove }: BoardCardProps): ReactElement {
  return (
    <article
      data-note-path={entry.path}
      className="flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-xs"
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2 text-left active:opacity-70"
        >
          <Note aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-text">
            {entry.title}
          </span>
          {openTasks > 0 ? <CollectionTaskBadge count={openTasks} /> : null}
        </button>
        <button
          type="button"
          aria-label={`Move ${entry.title}`}
          title={`Move from ${lane.label}`}
          onClick={onMove}
          className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-text-muted active:bg-surface-hover active:text-text"
        >
          <ChevronDown aria-hidden className="size-4" />
        </button>
      </div>
      <CardPropertyChips type={type} entry={entry} />
    </article>
  )
}

interface OptionRow {
  id: string
  label: string
  color: string | null
  count: number | null
}

function OptionList({
  options,
  selected,
  onPick,
}: {
  options: readonly OptionRow[]
  selected: string
  onPick: (id: string) => void
}): ReactElement {
  return (
    <div className="flex flex-col pb-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onPick(option.id)}
          className="flex h-12 items-center gap-3 border-b border-border text-left text-base last:border-b-0"
        >
          {option.color !== null ? (
            <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', option.color)} />
          ) : null}
          <span className={cn('min-w-0 flex-1 truncate', option.id === selected && 'font-medium')}>
            {option.label}
          </span>
          {option.count !== null ? (
            <span className="text-xs text-text-muted">{option.count}</span>
          ) : null}
          {option.id === selected ? <Check className="size-4 text-primary" /> : null}
        </button>
      ))}
    </div>
  )
}
