import { useState, type ReactElement } from 'react'
import {
  addMeetingToDaily,
  contactsAuthorizationStatus,
  defaultAttendees,
  errorMessage,
  isContactsReadable,
  notePath,
  resolveWikiTarget,
  slugForTitle,
  type CalendarEvent,
} from '@reflect/core'
import { Calendar } from '@/components/icons'
import { formatTimeOfDay } from '@/lib/dates'
import { useCalendarChangeInvalidation, useDayEvents } from '@/lib/use-calendar'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'

interface MobileDayEventsProps {
  /** ISO day currently shown on the daily spine. */
  date: string
}

/**
 * Today's meetings on the mobile daily spine. One tap writes a named
 * meeting note (and person notes for attendees) and appends it to the daily.
 */
export function MobileDayEvents({ date }: MobileDayEventsProps): ReactElement | null {
  const { settings } = useSettings()
  const { graph } = useGraph()
  const { navigate } = useRouter()
  useCalendarChangeInvalidation(settings.calendarEnabled)
  const events = useDayEvents(date)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (events.length === 0 || graph === null) {
    return null
  }

  const generation = graph.generation

  async function addEvent(event: CalendarEvent): Promise<void> {
    setPendingId(`${event.id}-${event.startsAt}`)
    setError(null)
    try {
      const lookupContacts =
        settings.contactsEnabled && isContactsReadable(await contactsAuthorizationStatus())
      const title = event.title.trim() || 'Meeting'
      await addMeetingToDaily({
        date,
        title,
        attendees: defaultAttendees(event),
        backlinkMeeting: true,
        lookupContacts,
        startTime: formatTimeOfDay(new Date(event.startsAt), settings.timeFormat),
        generation,
      })
      const resolution = await resolveWikiTarget(title)
      const path = resolution.kind === 'resolved' ? resolution.ref : notePath(slugForTitle(title))
      navigate({ kind: 'note', path })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section aria-label="Today’s meetings" className="shrink-0 border-b border-border px-4 py-2">
      <ul className="flex flex-col gap-1">
        {events.map((event) => {
          const key = `${event.id}-${event.startsAt}`
          const pending = pendingId === key
          return (
            <li key={key}>
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={() => void addEvent(event)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] text-text transition-colors active:bg-secondary/70 disabled:opacity-50"
              >
                <Calendar aria-hidden className="size-4 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {event.title.trim() || 'Untitled event'}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-text-muted">
                  {pending
                    ? 'Saving…'
                    : formatTimeOfDay(new Date(event.startsAt), settings.timeFormat)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {error !== null ? (
        <p className="px-2 pt-1 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
