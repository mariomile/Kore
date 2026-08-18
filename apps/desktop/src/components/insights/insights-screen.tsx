import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, format, subDays } from 'date-fns'
import { loadGraphInsights, weekStartDow, type GraphInsights } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { formatDayLabel } from '@/lib/dates'
import { useToday } from '@/lib/use-today'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

const LINKED_LIMIT = 10
const TAG_LIMIT = 10
const ACTIVITY_WEEKS = 17

/**
 * The Insights view: a read-only dashboard over the index — headline counts,
 * a writing-activity heatmap, the most-linked notes, and the most-used tags.
 * Everything is computed locally; nothing leaves the device.
 */
export function InsightsScreen(): ReactElement {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { navigate } = useRouter()
  const bridgeReady = useBridgeReady()
  const today = useToday()

  // The heatmap's first cell: the start of the week ACTIVITY_WEEKS-1 weeks
  // back, honoring the user's week-start day so columns read as real weeks.
  // Anchored on the shared live-today clock, so the grid rolls at midnight
  // with the rest of the app.
  const gridStart = useMemo(() => {
    const now = new Date(`${today}T00:00:00`)
    const sinceWeekStart = (now.getDay() - weekStartDow(settings.weekStartDay) + 7) % 7
    return subDays(now, sinceWeekStart + (ACTIVITY_WEEKS - 1) * 7)
  }, [today, settings.weekStartDay])

  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'insights', format(gridStart, 'yyyy-MM-dd')],
    queryFn: () =>
      loadGraphInsights({
        linkedLimit: LINKED_LIMIT,
        tagLimit: TAG_LIMIT,
        activitySince: format(gridStart, 'yyyy-MM-dd'),
      }),
    enabled: bridgeReady && graph !== null,
  })

  if (isError) {
    return (
      <p role="alert" className="px-6 py-8 text-sm text-text-muted">
        Couldn’t load insights.
      </p>
    )
  }
  if (data === undefined) {
    return <p className="px-6 py-8 text-sm text-text-muted">Loading…</p>
  }

  const openNote = (path: string): void => navigate(routeForPath(path))
  const openTag = (tag: string): void => navigate({ kind: 'allNotes', tag })
  const maxTagCount = Math.max(1, ...data.topTags.map((facet) => facet.count))

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Insights</h1>

      <section aria-label="Totals" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatTile label="Notes" value={data.noteCount} />
        <StatTile label="Daily notes" value={data.dailyNoteCount} />
        <StatTile label="Open tasks" value={data.openTaskCount} />
        <StatTile label="Done tasks" value={data.completedTaskCount} />
        <StatTile label="Tags" value={data.tagCount} />
      </section>

      <section aria-label="Writing activity" className="mt-10">
        <h2 className="text-2xs font-medium tracking-wide text-text-muted">Writing activity</h2>
        <ActivityHeatmap
          activity={data.activity}
          gridStart={gridStart}
          today={today}
          dateFormat={settings.dateFormat}
        />
      </section>

      {data.mostLinked.length > 0 ? (
        <section aria-label="Most linked notes" className="mt-10">
          <h2 className="text-2xs font-medium tracking-wide text-text-muted">Most linked notes</h2>
          <ul className="mt-2 flex flex-col">
            {data.mostLinked.map((note) => (
              <li key={note.path}>
                <button
                  type="button"
                  onClick={() => openNote(note.path)}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {note.dailyDate !== null
                      ? formatDayLabel(note.dailyDate, settings.dateFormat)
                      : note.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {note.backlinks} {note.backlinks === 1 ? 'link' : 'links'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.topTags.length > 0 ? (
        <section aria-label="Top tags" className="mt-10">
          <h2 className="text-2xs font-medium tracking-wide text-text-muted">Top tags</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {data.topTags.map((facet) => (
              <li key={facet.tag}>
                <button
                  type="button"
                  onClick={() => openTag(facet.tag)}
                  className="group flex w-full items-center gap-3 rounded-md px-2.5 py-1 text-left transition-colors duration-100 hover:bg-surface-hover"
                >
                  <span className="w-28 shrink-0 truncate text-xs font-medium text-text-secondary group-hover:text-text">
                    #{facet.tag}
                  </span>
                  <span className="h-2 min-w-0 flex-1 rounded-full bg-surface-sunken">
                    <span
                      className="block h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.max(4, (facet.count / maxTagCount) * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-muted">
                    {facet.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="text-xl font-semibold tabular-nums tracking-tight text-text">{value}</div>
      <div className="mt-0.5 text-2xs text-text-muted">{label}</div>
    </div>
  )
}

/** Bucket a day's edit count into one of the heatmap's fill steps. */
function heatClass(edited: number): string {
  if (edited === 0) {
    return 'bg-surface-sunken'
  }
  if (edited <= 1) {
    return 'bg-accent/25'
  }
  if (edited <= 3) {
    return 'bg-accent/45'
  }
  if (edited <= 6) {
    return 'bg-accent/70'
  }
  return 'bg-accent'
}

interface ActivityHeatmapProps {
  activity: GraphInsights['activity']
  gridStart: Date
  /** Today's ISO date — cells after it render invisible. */
  today: string
  dateFormat: Parameters<typeof formatDayLabel>[1]
}

/**
 * A contribution-style grid: one column per week, one cell per day, filled
 * by how many notes were edited that day. Future days render invisible so
 * the last column keeps the grid's shape without claiming empty activity.
 */
function ActivityHeatmap({
  activity,
  gridStart,
  today,
  dateFormat,
}: ActivityHeatmapProps): ReactElement {
  const byDate = new Map(activity.map((day) => [day.date, day.edited]))
  const todayKey = today
  const weeks = [...Array(ACTIVITY_WEEKS).keys()]
  const days = [...Array(7).keys()]
  return (
    <div className="mt-2 overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week) => (
          <div key={week} className="flex flex-col gap-[3px]">
            {days.map((day) => {
              const date = addDays(gridStart, week * 7 + day)
              const key = format(date, 'yyyy-MM-dd')
              if (key > todayKey) {
                return <span key={day} className="size-3 rounded-[3px]" aria-hidden />
              }
              const edited = byDate.get(key) ?? 0
              return (
                <span
                  key={day}
                  role="img"
                  aria-label={`${formatDayLabel(key, dateFormat)}: ${edited} ${edited === 1 ? 'note' : 'notes'} edited`}
                  title={`${formatDayLabel(key, dateFormat)} — ${edited} edited`}
                  className={cn('size-3 rounded-[3px]', heatClass(edited))}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
