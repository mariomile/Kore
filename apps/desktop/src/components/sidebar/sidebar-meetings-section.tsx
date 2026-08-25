import { useState, type ReactElement } from 'react'
import { errorMessage, resolveOrCreateNoteWithTitle, type CalendarEvent } from '@reflect/core'
import { Calendar } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { formatTimeOfDay } from '@/lib/dates'
import { useToday } from '@/lib/use-today'
import {
  UPCOMING_EVENTS_DAYS,
  useCalendarChangeInvalidation,
  useUpcomingEvents,
} from '@/lib/use-calendar'
import { groupEventsByDay, upcomingDayLabel } from '@/lib/upcoming-events'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'

/**
 * The Meetings rail: what the workspace sidebar shows while the Meetings
 * surface is selected. The coming week's events from the enabled calendars,
 * grouped under Today/Tomorrow/weekday headers; selecting one opens the
 * meeting's own note — resolved through the wiki-link rules and created on
 * first open — so every meeting accumulates notes in one place. With the
 * integration off (or no calendars picked) the rail points at Settings
 * instead of rendering an empty shelf.
 */
export function SidebarMeetingsSection(): ReactElement {
  const { settings } = useSettings()
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const today = useToday()
  useCalendarChangeInvalidation(settings.calendarEnabled)
  const events = useUpcomingEvents(today)
  const [openError, setOpenError] = useState<string | null>(null)

  const openEventNote = async (event: CalendarEvent): Promise<void> => {
    if (graph === null) {
      return
    }
    setOpenError(null)
    try {
      const outcome = await resolveOrCreateNoteWithTitle(event.title, graph.generation)
      // An ambiguous title opens the same sorted-first winner read-only
      // wiki-link resolution would; only an unavailable target (an iCloud
      // placeholder, an uncreatable spelling) has no note to open.
      const path =
        outcome.kind === 'resolved' || outcome.kind === 'created'
          ? outcome.path
          : outcome.kind === 'ambiguous'
            ? [...outcome.paths].sort().at(0)
            : undefined
      if (path === undefined) {
        setOpenError(`“${event.title}” has no openable note on this device yet.`)
        return
      }
      navigate({ kind: 'note', path })
    } catch (cause) {
      setOpenError(errorMessage(cause))
    }
  }

  const setupNeeded = !settings.calendarEnabled || settings.calendarIds.length === 0
  const groups = groupEventsByDay(events)

  return (
    <div
      aria-label="Meetings"
      className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-border/50 px-2 pb-2 pt-2"
    >
      {setupNeeded ? (
        <div className="px-2 pt-2">
          <p className="text-xs leading-5 text-text-muted">
            Connect your calendar to see meetings here.
          </p>
          <button
            type="button"
            onClick={() => navigate({ kind: 'settings' })}
            className="mt-2 text-xs font-medium text-accent hover:underline"
          >
            Open Settings
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="px-2 pt-2 text-xs leading-5 text-text-muted">
          No meetings in the next {UPCOMING_EVENTS_DAYS} days.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.date} aria-label={upcomingDayLabel(group.date, today)}>
            <h2 className="pt-4 text-2xs font-medium leading-5 tracking-wide text-text-muted">
              {upcomingDayLabel(group.date, today)}
            </h2>
            <ul className="mt-1 space-y-0.5">
              {group.events.map((event) => (
                <li key={`${event.id}-${event.startsAt}`}>
                  <button
                    type="button"
                    onClick={() => void openEventNote(event)}
                    title="Open meeting note"
                    className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-text-secondary hover:bg-surface-hover hover:text-text"
                  >
                    <Calendar aria-hidden className="size-3.5 shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
                    <span className="shrink-0 text-2xs tabular-nums text-text-muted">
                      {formatTimeOfDay(new Date(event.startsAt), settings.timeFormat)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {openError !== null && (
        <div className="px-2 pt-3">
          <InlineAlert tone="error">{openError}</InlineAlert>
        </div>
      )}
    </div>
  )
}
