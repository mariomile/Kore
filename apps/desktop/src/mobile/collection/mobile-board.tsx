import { useMemo, useState, type ReactElement } from 'react'
import { Virtualizer } from 'virtua'
import type { CollectionEntry, TagProperty, TagType } from '@kore/core'
import { CardPropertyChips } from '@/components/all-notes/card-property-chips'
import {
  boardColumns,
  overlayValue,
  type BoardColumn,
} from '@/components/all-notes/collection-board'
import { CollectionTaskBadge } from '@/components/all-notes/collection-task-badge'
import { Check, ChevronDown, Plus } from '@/components/icons'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useOpenTaskCounts } from '@/hooks/use-open-task-counts'
import { useOptimisticMoves } from '@/hooks/use-optimistic-moves'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'
import { useCreateCollectionNote } from '@/lib/tags/use-create-collection-note'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { laneMove } from './board-move'

/** Lane pill row height; the card list pads past it (and the glass header). */
const LANE_BAR_HEIGHT = '3.25rem'
/** A card's estimated height before the virtualizer measures it. */
const CARD_HEIGHT = 96

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

/**
 * The type's board on a phone (TDR 0005): the desktop board's lanes, one at
 * a time. A pill row picks the lane (each shows its count), the lane's cards
 * stack full width with the type's property chips, and a card moves with one
 * tap on its value pill, which opens the lanes as a sheet. Drag would fight
 * the list's scroll and the shell's swipes, so the tap path is the only
 * one. A move lands at once through the same optimistic overlay as the
 * desktop board, then the shared property commit writes the frontmatter.
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
  const [laneLabel, setLaneLabel] = useState<string | null>(null)
  const [moving, setMoving] = useState<CollectionEntry | null>(null)
  const [choosingGroup, setChoosingGroup] = useState(false)

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
  // The card's chips skip the grouped property: its move pill already says it.
  const chipType = useMemo(
    () => ({ ...type, properties: type.properties.filter((p) => p.key !== property.key) }),
    [type, property.key],
  )
  const columns = useMemo(
    () => boardColumns(effectiveEntries, property),
    [effectiveEntries, property],
  )
  // The picked lane, else the first one with cards, so the board never opens
  // on an empty lane when another holds notes.
  const active =
    columns.find((column) => column.label === laneLabel) ??
    columns.find((column) => column.entries.length > 0) ??
    (columns[0] as BoardColumn)

  const moveTo = (entry: CollectionEntry, to: BoardColumn): void => {
    setMoving(null)
    const move = laneMove(property, entry, active, to)
    if (move === 'unchanged') {
      return
    }
    hapticImpactLight()
    // Stay on this lane even when its last card just left it.
    setLaneLabel(active.label)
    record(entry.path, move.value)
    commitProperties(entry.path, { [property.key]: move.value ?? undefined })
  }

  const createInLane = async (): Promise<void> => {
    const laneValue =
      property.type === 'multiselect' && typeof active.commit === 'string'
        ? [active.commit]
        : active.commit
    const path = await createNote(laneValue === null ? {} : { [property.key]: laneValue })
    if (path !== null) {
      onOpen(path)
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <nav
        aria-label={`${property.name} lanes`}
        data-base-ui-swipe-ignore
        className="mobile-glass-bar absolute inset-x-0 z-20 flex items-center gap-1.5 overflow-x-auto px-4"
        style={{ top: 'var(--mobile-header-height, 0px)', height: LANE_BAR_HEIGHT }}
      >
        {groupProperties.length > 1 ? (
          <button
            type="button"
            onClick={() => setChoosingGroup(true)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-sm text-text-secondary"
          >
            {property.name}
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
        ) : null}
        {columns.map((column) => {
          const selected = column.label === active.label
          return (
            <button
              key={column.label}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                hapticImpactLight()
                setLaneLabel(column.label)
              }}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm transition-colors',
                selected
                  ? 'bg-text font-medium text-surface'
                  : 'bg-surface-hover text-text-secondary',
              )}
            >
              {column.color !== null ? (
                <span aria-hidden className={cn('size-2 shrink-0 rounded-full', column.color)} />
              ) : null}
              {column.label}
              <span className={cn('tabular-nums', selected ? 'opacity-70' : 'text-text-muted')}>
                {column.entries.length}
              </span>
            </button>
          )
        })}
      </nav>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4"
        style={{
          paddingTop: `calc(var(--mobile-header-height, 0px) + ${LANE_BAR_HEIGHT} + 0.5rem)`,
          paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
        }}
      >
        <section aria-label={active.label}>
          <button
            type="button"
            onClick={() => void createInLane()}
            className="mb-2 flex h-11 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm text-text-muted active:bg-surface-hover"
          >
            <Plus aria-hidden className="size-4" />
            New in {active.label}
          </button>
          {entries !== undefined && active.entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-muted">Nothing in {active.label}</p>
          ) : null}
          <Virtualizer data={active.entries} itemSize={CARD_HEIGHT} bufferSize={480}>
            {(entry) => (
              <div key={entry.path} className="pb-2">
                <BoardCard
                  entry={entry}
                  type={chipType}
                  lane={active}
                  openTasks={taskCounts[entry.path] ?? 0}
                  onOpen={() => onOpen(entry.path)}
                  onMove={() => setMoving(entry)}
                />
              </div>
            )}
          </Virtualizer>
        </section>
      </div>
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
              selected={active.label}
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
                setLaneLabel(null)
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
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 items-start gap-2 text-left active:opacity-70"
      >
        <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-text">
          {entry.title}
        </span>
        {openTasks > 0 ? <CollectionTaskBadge count={openTasks} /> : null}
      </button>
      <CardPropertyChips type={type} entry={entry} />
      <button
        type="button"
        aria-label={`Move ${entry.title}`}
        onClick={onMove}
        className="flex h-9 items-center gap-1.5 self-start rounded-full bg-surface-hover px-3 text-xs text-text-secondary active:bg-surface-active"
      >
        {lane.color !== null ? (
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', lane.color)} />
        ) : null}
        {lane.label}
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
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
