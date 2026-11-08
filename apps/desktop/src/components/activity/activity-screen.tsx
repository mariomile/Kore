import { useMemo, useState, type ReactElement } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  activityAuthorKey,
  gitActivity,
  groupSittings,
  noteFileStem,
  type ActivityAuthor,
  type ActivitySitting,
  type SittingNote,
} from '@reflect/core'
import { NoteHistoryDialog } from '@/components/note-history-dialog'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { formatDayLabel, formatTimeOfDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { settingsRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'

/** Commits per page of the log. */
const PAGE_SIZE = 100
/** Notes listed under a sitting before "and N more". */
const NOTES_SHOWN = 8

const ALL_AUTHORS = 'all'

/** What a person reads for an author. */
export function authorLabel(author: ActivityAuthor): string {
  switch (author.kind) {
    case 'owner':
      return 'You'
    case 'host':
      return 'Always-on host'
    case 'agent':
      return author.name
  }
}

const KIND_LABEL: Record<SittingNote['kind'], string> = {
  added: 'added',
  modified: 'edited',
  deleted: 'deleted',
  renamed: 'renamed',
}

interface DayGroup {
  readonly day: string
  readonly sittings: ActivitySitting[]
}

function groupByDay(sittings: readonly ActivitySitting[]): DayGroup[] {
  const days: DayGroup[] = []
  for (const sitting of sittings) {
    const day = format(new Date(sitting.endMs), 'yyyy-MM-dd')
    const last = days.at(-1)
    if (last?.day === day) {
      last.sittings.push(sitting)
    } else {
      days.push({ day, sittings: [sitting] })
    }
  }
  return days
}

/**
 * The vault's activity log (Plan 33, A1 step 5): every change in the backup
 * repository, grouped into sittings (one author's run of work) and days,
 * newest first. Agents are named by their `Kore-Agent` trailer, so you can
 * see what each one did; a note row opens that note's history at the change.
 * Read-only: undoing a sitting comes in the next step.
 */
export function ActivityScreen(): ReactElement {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { navigate } = useRouter()
  const bridgeReady = useBridgeReady()
  const generation = graph?.generation ?? null
  const [authorFilter, setAuthorFilter] = useState<string>(ALL_AUTHORS)
  const [historyOf, setHistoryOf] = useState<SittingNote | null>(null)

  const { data, isError, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['activity', graph?.root, generation],
      queryFn: ({ pageParam }) =>
        generation === null
          ? Promise.resolve({ commits: [], next: null })
          : gitActivity(pageParam, PAGE_SIZE, generation),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.next ?? undefined,
      enabled: bridgeReady && generation !== null,
      staleTime: 30_000,
    })

  const sittings = useMemo(
    () => groupSittings(data?.pages.flatMap((page) => page.commits) ?? []),
    [data],
  )
  const authors = useMemo(() => {
    const seen = new Map<string, ActivityAuthor>()
    for (const sitting of sittings) {
      seen.set(activityAuthorKey(sitting.author), sitting.author)
    }
    return [...seen]
  }, [sittings])
  const days = useMemo(
    () =>
      groupByDay(
        authorFilter === ALL_AUTHORS
          ? sittings
          : sittings.filter((sitting) => activityAuthorKey(sitting.author) === authorFilter),
      ),
    [sittings, authorFilter],
  )

  if (isError) {
    // No backup repository yet (or none on this platform): the log has
    // nothing to read, so point at the switch that starts it.
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Activity</h1>
        <p role="status" className="mt-4 text-sm text-text-muted">
          Activity is read from the vault’s backup history. Turn on backup to see what you and your
          agents change.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => navigate(settingsRoute('data'))}
        >
          Open backup settings
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Activity</h1>
      <p className="mt-1 text-sm text-text-muted">
        What you and your agents changed in this vault, newest first.
      </p>

      {authors.length > 1 ? (
        <div role="group" aria-label="Filter by author" className="mt-5 flex flex-wrap gap-1.5">
          <FilterChip
            label="Everyone"
            active={authorFilter === ALL_AUTHORS}
            onClick={() => setAuthorFilter(ALL_AUTHORS)}
          />
          {authors.map(([key, author]) => (
            <FilterChip
              key={key}
              label={authorLabel(author)}
              active={authorFilter === key}
              onClick={() => setAuthorFilter(key)}
            />
          ))}
        </div>
      ) : null}

      {isPending ? (
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      ) : days.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">No changes yet.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {days.map((group) => (
            <section key={group.day} aria-label={formatDayLabel(group.day, settings.dateFormat)}>
              <h2 className="text-xs font-medium tracking-wide text-text-muted uppercase">
                {formatDayLabel(group.day, settings.dateFormat)}
              </h2>
              <ol className="mt-2 space-y-3">
                {group.sittings.map((sitting) => (
                  <SittingRow
                    key={sitting.id}
                    sitting={sitting}
                    timeFormat={settings.timeFormat}
                    onOpenNote={setHistoryOf}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-6"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage({ cancelRefetch: false })}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load older changes'}
        </Button>
      ) : null}

      {historyOf !== null ? (
        <NoteHistoryDialog
          path={historyOf.path}
          open
          onOpenChange={(open) => {
            if (!open) {
              setHistoryOf(null)
            }
          }}
          initialCommit={historyOf.commit}
        />
      ) : null}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-100',
        active
          ? 'border-accent bg-accent/10 text-text'
          : 'border-border text-text-secondary hover:bg-surface-hover',
      )}
    >
      {label}
    </button>
  )
}

function SittingRow({
  sitting,
  timeFormat,
  onOpenNote,
}: {
  sitting: ActivitySitting
  timeFormat: Parameters<typeof formatTimeOfDay>[1]
  onOpenNote: (note: SittingNote) => void
}): ReactElement {
  const start = formatTimeOfDay(new Date(sitting.startMs), timeFormat)
  const end = formatTimeOfDay(new Date(sitting.endMs), timeFormat)
  const shown = sitting.notes.slice(0, NOTES_SHOWN)
  const hidden = sitting.notes.length - shown.length
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'text-sm font-medium',
            sitting.author.kind === 'agent' ? 'text-accent' : 'text-text',
          )}
        >
          {authorLabel(sitting.author)}
        </span>
        <span className="text-xs text-text-muted">
          {start === end ? start : `${start} – ${end}`}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {sitting.notes.length === 1 ? '1 note' : `${sitting.notes.length} notes`}
        </span>
      </div>
      <ul className="mt-1">
        {shown.map((note) => (
          <li key={note.path}>
            <button
              type="button"
              onClick={() => onOpenNote(note)}
              className="flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left hover:bg-surface-hover"
            >
              <span className="truncate text-sm text-text-secondary">
                {noteFileStem(note.path)}
              </span>
              <span className="shrink-0 text-2xs text-text-muted">{KIND_LABEL[note.kind]}</span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className="px-1 text-2xs text-text-muted">and {hidden} more</p> : null}
    </li>
  )
}
