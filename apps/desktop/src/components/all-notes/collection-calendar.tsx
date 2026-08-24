import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import {
  errorMessage,
  isCalendarDate,
  weekStartDow,
  type CollectionEntry,
  type CollectionValue,
  type TagProperty,
} from '@reflect/core'
import { ChevronLeft, ChevronRight, Plus } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { createCollectionNote } from '@/lib/tags/create-collection-note'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
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
  return type.properties.find((property) => property.type === 'date') ?? null
}

/** Local `YYYY-MM-DD` for a Date (the daily-note key space). */
function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
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

interface MonthCell {
  iso: string
  day: number
  inMonth: boolean
}

/** Six weeks of cells covering `year`/`month`, aligned to the week start. */
export function monthGrid(year: number, month: number, weekStart: 0 | 1 | 6): MonthCell[] {
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7
  const cells: MonthCell[] = []
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, 1 - lead + index)
    cells.push({ iso: toIso(date), day: date.getDate(), inMonth: date.getMonth() === month })
  }
  return cells
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
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionCalendar({
  entries,
  property,
  tag,
  onOpen,
}: CollectionCalendarProps): ReactElement {
  const weekStartDay = useSettings().settings.weekStartDay
  const weekStart = weekStartDow(weekStartDay)
  const { graph } = useGraph()
  const commitProperties = useCommitNoteProperties()
  const [now] = useState(() => new Date())
  const [visible, setVisible] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }))
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const [moves, setMoves] = useState(() => new Map<string, string>())
  const todayIso = toIso(now)

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
  const cells = useMemo(
    () => monthGrid(visible.year, visible.month, weekStart),
    [visible, weekStart],
  )
  const weekdayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) =>
      new Date(2024, 0, 1 + ((weekStart + 6) % 7) + index).toLocaleDateString(undefined, {
        weekday: 'short',
      }),
    )
  }, [weekStart])
  const monthLabel = new Date(visible.year, visible.month).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const shift = (delta: number): void => {
    const date = new Date(visible.year, visible.month + delta)
    setVisible({ year: date.getFullYear(), month: date.getMonth() })
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
    setMoves((existing) => new Map(existing).set(path, iso))
    commitProperties(path, { [property.key]: iso })
  }

  const createOnDay = async (iso: string): Promise<void> => {
    if (graph === null) {
      return
    }
    try {
      const path = await createCollectionNote(tag, graph.generation, { [property.key]: iso })
      onOpen(path)
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't create the note",
        description: errorMessage(error),
      })
    }
  }

  return (
    <div className="flex h-full flex-col px-12 pb-6">
      <div className="flex flex-none items-center justify-between py-2">
        <h2 className="text-sm font-medium text-text">{monthLabel}</h2>
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
            onClick={() => setVisible({ year: now.getFullYear(), month: now.getMonth() })}
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
        {weekdayLabels.map((label) => (
          <span key={label} className="px-1.5 text-xs font-medium text-text-muted">
            {label}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {cells.map((cell) => {
          const dayEntries = byDate.get(cell.iso) ?? []
          return (
            <div
              key={cell.iso}
              data-calendar-day={cell.iso}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                if (draggingPath !== null) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropDay(cell.iso)
                }
              }}
              onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropDay((current) => (current === cell.iso ? null : current))
                }
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault()
                dropOnDay(cell.iso)
              }}
              className={cn(
                'group flex min-h-20 flex-col gap-0.5 border-b border-r border-border/60 p-1.5',
                !cell.inMonth && 'opacity-40',
                draggingPath !== null && dropDay === cell.iso && 'bg-accent/10 ring-1 ring-accent/40',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    cell.iso === todayIso ? 'font-semibold text-accent' : 'text-text-muted',
                  )}
                >
                  {cell.day}
                </span>
                <button
                  type="button"
                  aria-label={`New note on ${cell.iso}`}
                  onClick={() => void createOnDay(cell.iso)}
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
