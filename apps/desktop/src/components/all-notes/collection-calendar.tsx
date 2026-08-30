import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import {
  isCalendarDate,
  weekStartDow,
  type CollectionEntry,
  type CollectionValue,
  type TagProperty,
  type TagType,
} from '@reflect/core'
import { ChevronLeft, ChevronRight, Plus } from '@/components/icons'
import { useOptimisticMoves } from '@/hooks/use-optimistic-moves'
import { todayIso } from '@/lib/dates'
import { addMonths, buildMonthGrid, monthLabel, monthOf, weekdayLabels } from '@/lib/month-grid'
import { calendarPropertyOf } from '@/lib/tags/schema-views'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'
import { useCreateCollectionNote } from '@/lib/tags/use-create-collection-note'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { readCellValue } from './collection-cell'

/**
 * The Collection's calendar (TDR 0005): a month grid with each row placed on
 * the day its date property holds. Cards drag onto a day to write that ISO
 * date; a day's + births a tagged note already dated. Notes whose value isn't
 * a calendar date simply don't appear (the table still shows them raw).
 */

/** The property the calendar places by: the schema's first `date`. */
export function calendarProperty(type: { properties: readonly TagProperty[] }): TagProperty | null {
  return calendarPropertyOf(type.properties)
}

/** Entries grouped by their calendar-date value under `property`. */
export function entriesByDate(
  entries: readonly CollectionEntry[],
  property: TagProperty,
): Map<string, CollectionEntry[]> {
  const byDate = new Map<string, CollectionEntry[]>()
  for (const entry of entries) {
    const reading = readCellValue(property, entry.properties[property.key])
    if (reading.mismatch || !isCalendarDate(reading.text)) {
      continue
    }
    byDate.set(reading.text, [...(byDate.get(reading.text) ?? []), entry])
  }
  return byDate
}

const MAX_NOTES_PER_DAY = 3

function datedValue(iso: string): CollectionValue {
  return { value: iso, valueType: 'string', valueNumber: null }
}

interface CollectionCalendarProps {
  entries: readonly CollectionEntry[] | undefined
  /** The placing date property — the screen only renders the calendar when
   * {@link calendarProperty} found one. */
  property: TagProperty
  /** The active tag, so a day's + can birth a row in this collection. */
  tag: string
  /** The tag's type, so a new row can seed from a bound template. */
  type: TagType
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionCalendar({
  entries,
  property,
  tag,
  type,
  onOpen,
}: CollectionCalendarProps): ReactElement {
  const weekStartDay = useSettings().settings.weekStartDay
  const weekStart = weekStartDow(weekStartDay)
  const commitProperties = useCommitNoteProperties()
  const createNote = useCreateCollectionNote(tag, type)
  const [today] = useState(() => todayIso())
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(today))
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const { moves, record } = useOptimisticMoves<string>(entries)

  const effectiveEntries = useMemo(() => {
    return (entries ?? []).map((entry) => {
      const iso = moves.get(entry.path)
      if (iso === undefined) {
        return entry
      }
      return {
        ...entry,
        properties: { ...entry.properties, [property.key]: datedValue(iso) },
      }
    })
  }, [entries, moves, property.key])

  const byDate = useMemo(
    () => entriesByDate(effectiveEntries, property),
    [effectiveEntries, property],
  )
  // The same grid math as the daily sidebar and task-schedule calendars —
  // one week-start convention and one set of header labels everywhere.
  const cells = useMemo(
    () => buildMonthGrid(visibleMonth, weekStart).weeks.flat(),
    [visibleMonth, weekStart],
  )
  const dayLabels = useMemo(() => weekdayLabels(weekStart), [weekStart])

  const shift = (delta: number): void => {
    setVisibleMonth((current) => addMonths(current, delta))
  }

  const endDrag = (): void => {
    setDraggingPath(null)
    setDropDay(null)
  }

  const dropOnDay = (iso: string): void => {
    const path = draggingPath
    endDrag()
    if (path === null) {
      return
    }
    const current = readCellValue(
      property,
      effectiveEntries.find((entry) => entry.path === path)?.properties[property.key],
    )
    if (!current.mismatch && current.text === iso) {
      return
    }
    record(path, iso)
    commitProperties(path, { [property.key]: iso })
  }

  const createOnDay = async (iso: string): Promise<void> => {
    const path = await createNote({ [property.key]: iso })
    if (path !== null) {
      onOpen(path)
    }
  }

  return (
    <div className="flex h-full flex-col px-12 pb-6">
      <div className="flex flex-none items-center justify-between py-2">
        <h2 className="text-sm font-medium text-text">{monthLabel(visibleMonth)}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:text-text-secondary"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Today"
            onClick={() => setVisibleMonth(monthOf(today))}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shift(1)}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:text-text-secondary"
          >
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="grid flex-none grid-cols-7 border-b border-border pb-1">
        {dayLabels.map((label) => (
          <span key={label} className="px-1.5 text-xs font-medium text-text-muted">
            {label}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {cells.map((cell) => {
          const dayEntries = byDate.get(cell.date) ?? []
          return (
            <div
              key={cell.date}
              data-calendar-day={cell.date}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                if (draggingPath !== null) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropDay(cell.date)
                }
              }}
              onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropDay((current) => (current === cell.date ? null : current))
                }
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault()
                dropOnDay(cell.date)
              }}
              className={cn(
                'group flex min-h-20 flex-col gap-0.5 border-b border-r border-border/60 p-1.5',
                !cell.inMonth && 'opacity-40',
                draggingPath !== null &&
                  dropDay === cell.date &&
                  'bg-accent/10 ring-1 ring-accent/40',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    cell.date === today ? 'font-semibold text-accent' : 'text-text-muted',
                  )}
                >
                  {Number(cell.date.slice(8, 10))}
                </span>
                <button
                  type="button"
                  aria-label={`New note on ${cell.date}`}
                  onClick={() => void createOnDay(cell.date)}
                  className="flex size-4 items-center justify-center rounded text-text-muted opacity-0 hover:text-text-secondary group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Plus aria-hidden className="size-3" />
                </button>
              </div>
              {dayEntries.slice(0, MAX_NOTES_PER_DAY).map((entry) => (
                <article
                  key={entry.path}
                  draggable
                  data-note-path={entry.path}
                  onDragStart={(event: DragEvent<HTMLElement>) => {
                    setDraggingPath(entry.path)
                    event.dataTransfer.setData('text/plain', entry.path)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={endDrag}
                  className={cn(
                    'cursor-grab rounded bg-surface-hover active:cursor-grabbing',
                    draggingPath === entry.path && 'opacity-50',
                  )}
                >
                  <button
                    type="button"
                    onClick={(event) => onOpen(entry.path, event)}
                    className="w-full truncate px-1.5 py-0.5 text-left text-xs text-text-secondary hover:text-text"
                  >
                    {entry.title}
                  </button>
                </article>
              ))}
              {dayEntries.length > MAX_NOTES_PER_DAY ? (
                <span className="px-1.5 text-[11px] text-text-muted">
                  +{dayEntries.length - MAX_NOTES_PER_DAY} more
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
