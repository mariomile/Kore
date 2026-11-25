import { useMemo, useState, type ReactElement } from 'react'
import { weekStartDow, type CollectionEntry, type TagProperty, type TagType } from '@kore/core'
import { CardPropertyChips } from '@/components/all-notes/card-property-chips'
import { entriesByDate } from '@/components/all-notes/collection-calendar'
import { ChevronLeft, ChevronRight, Plus } from '@/components/icons'
import { todayIso } from '@/lib/dates'
import { addMonths, buildMonthGrid, monthLabel, monthOf, weekdayLabels } from '@/lib/month-grid'
import { useCreateCollectionNote } from '@/lib/tags/use-create-collection-note'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { useSettings } from '@/providers/settings-provider'

/** A day shows up to this many dots; more read as the same "busy" day. */
const MAX_DOTS = 3

interface MobileCalendarProps {
  /** The rows the view shows (its filters and search already applied). */
  entries: readonly CollectionEntry[]
  /** The date field rows are placed by. */
  property: TagProperty
  tag: string
  /** The full schema, so a new row seeds from the type's template. */
  type: TagType
  /** The schema the cards show (hidden fields left out). */
  cardType: TagType
  onOpen: (path: string) => void
}

/**
 * A type's calendar on a phone (Notion's and Craft's mobile calendar): the
 * month as a compact grid where each day carries a dot per note dated on it,
 * and the picked day's notes listed below as cards. The same date field and
 * placement as the Mac's calendar, so a note sits on the same day on both.
 * Moving a note to another day is a tap on its date in the note (or in the
 * table): drag would fight the page's scroll. "New" makes a note already
 * dated on the picked day and opens it.
 */
export function MobileCalendar({
  entries,
  property,
  tag,
  type,
  cardType,
  onOpen,
}: MobileCalendarProps): ReactElement {
  const { settings } = useSettings()
  const weekStart = weekStartDow(settings.weekStartDay)
  const [today] = useState(() => todayIso())
  const [month, setMonth] = useState(() => monthOf(today))
  const [selected, setSelected] = useState(today)
  const createNote = useCreateCollectionNote(tag, type)

  const byDate = useMemo(() => entriesByDate(entries, property), [entries, property])
  const weeks = useMemo(() => buildMonthGrid(month, weekStart).weeks, [month, weekStart])
  const dayLabels = useMemo(() => weekdayLabels(weekStart), [weekStart])
  const dayEntries = byDate.get(selected) ?? []
  const datedCount = useMemo(() => {
    let count = 0
    for (const list of byDate.values()) {
      count += list.length
    }
    return count
  }, [byDate])
  const undated = entries.length - datedCount

  const shift = (delta: number): void => {
    haptic('selection')
    setMonth((current) => addMonths(current, delta))
  }
  const pick = (iso: string): void => {
    haptic('selection')
    setSelected(iso)
    if (monthOf(iso) !== month) {
      setMonth(monthOf(iso))
    }
  }
  const create = async (): Promise<void> => {
    haptic('action')
    const path = await createNote({ [property.key]: selected })
    if (path !== null) {
      onOpen(path)
    }
  }

  return (
    <div
      data-base-ui-swipe-ignore
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      style={{
        paddingTop: 'var(--mobile-header-height, 0px)',
        paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
      }}
    >
      <div className="px-4 pt-3">
        <div className="flex h-11 items-center">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{monthLabel(month)}</h2>
          {month !== monthOf(today) || selected !== today ? (
            <button
              type="button"
              onClick={() => pick(today)}
              className="h-8 rounded-full bg-surface-hover px-3 text-[13px] font-medium text-text active:opacity-60"
            >
              Today
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
            className="ml-1 flex size-11 items-center justify-center rounded-full text-text-muted active:bg-surface-hover"
          >
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shift(1)}
            className="-mr-2 flex size-11 items-center justify-center rounded-full text-text-muted active:bg-surface-hover"
          >
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
        <div role="grid" aria-label={monthLabel(month)} className="pt-1">
          <div role="row" className="grid grid-cols-7">
            {dayLabels.map((label) => (
              <span
                key={label}
                role="columnheader"
                className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-text-muted"
              >
                {label}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]?.date} role="row" className="grid grid-cols-7">
              {week.map((cell) => {
                const count = byDate.get(cell.date)?.length ?? 0
                const isSelected = cell.date === selected
                const isToday = cell.date === today
                return (
                  <button
                    key={cell.date}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelected}
                    aria-label={dayAriaLabel(cell.date, count)}
                    onClick={() => pick(cell.date)}
                    className="flex h-12 flex-col items-center justify-start gap-1 pt-1"
                  >
                    <span
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full text-[15px] tabular-nums transition-colors',
                        isSelected
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : isToday
                            ? 'font-semibold text-primary'
                            : cell.inMonth
                              ? 'text-text'
                              : 'text-text-muted/50',
                      )}
                    >
                      {Number(cell.date.slice(8))}
                    </span>
                    <span aria-hidden className="flex h-1 items-center gap-0.5">
                      {Array.from({ length: Math.min(count, MAX_DOTS) }, (_, index) => (
                        <span
                          key={index}
                          className={cn(
                            'size-1 rounded-full',
                            cell.inMonth ? 'bg-text-secondary' : 'bg-text-muted/40',
                          )}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <section aria-label={dayHeading(selected)} className="px-4 pt-5 pb-6">
        <div className="flex items-baseline gap-2 px-1 pb-2">
          <h3 className="text-[15px] font-semibold">{dayHeading(selected)}</h3>
          {dayEntries.length > 0 ? (
            <span className="text-[13px] tabular-nums text-text-muted">{dayEntries.length}</span>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {dayEntries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => onOpen(entry.path)}
              className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-3 text-left shadow-sm active:bg-surface-hover"
            >
              <span className="text-[15px] font-medium leading-snug text-text">{entry.title}</span>
              <CardPropertyChips type={cardType} entry={entry} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => void create()}
            className="flex h-11 items-center gap-2 rounded-xl px-3.5 text-[15px] text-text-muted active:bg-surface-hover"
          >
            <Plus aria-hidden className="size-4" />
            {dayEntries.length === 0 ? `New on ${shortDay(selected)}` : 'New'}
          </button>
        </div>
        {undated > 0 ? (
          <p className="px-1 pt-4 text-[13px] text-text-muted">
            {undated === 1 ? '1 note has' : `${undated} notes have`} no {property.name}, so{' '}
            {undated === 1 ? 'it shows' : 'they show'} in the table.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

/** "Tuesday, November 18" */
function dayHeading(iso: string): string {
  return dateOf(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** "Nov 18" */
function shortDay(iso: string): string {
  return dateOf(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dayAriaLabel(iso: string, count: number): string {
  const day = dayHeading(iso)
  if (count === 0) {
    return day
  }
  return `${day}, ${count} ${count === 1 ? 'note' : 'notes'}`
}
