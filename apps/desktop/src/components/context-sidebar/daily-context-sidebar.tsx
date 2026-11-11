import type { ReactElement } from 'react'
import { dailyPath } from '@kore/core'
import { DailyEventsSection } from './daily-events-section'
import { DetailsSections } from './details-sections'
import { DayCalendar } from './day-calendar'
import { NoteActionsSection } from './note-actions-section'
import { NoteHistorySection } from './note-history-section'
import { PublishedUrlSection } from './published-url-section'
import { SimilarNotesSection } from './similar-notes-section'
import { useToday } from '@/lib/use-today'

interface DailyContextSidebarProps {
  /** The day the sidebar describes — a validated ISO date from the route. */
  date: string
}

/**
 * The daily note's contextual sidebar (modeled on the old app's note context
 * sidebar): the month calendar up top — itself the day-navigation surface,
 * with a jump-to-today button — then the day's calendar events, semantic
 * neighbors, history, and last the rarely used note actions. Inbound links live under the note itself
 * (the incoming-backlinks section), not here. The calendar stays on top; the
 * sections below follow the user's Details arrangement. Rendered in the AppShell's
 * right region on daily routes only.
 */
export function DailyContextSidebar({ date }: DailyContextSidebarProps): ReactElement {
  const today = useToday()
  const path = dailyPath(date)

  return (
    <div className="flex flex-col pt-2 text-text">
      <DayCalendar selectedDate={date} today={today} />
      <div className="my-4 pb-4">
        <DetailsSections
          sections={[
            { id: 'events', title: 'Events', node: <DailyEventsSection date={date} /> },
            {
              id: 'publishedUrl',
              title: 'Published URL',
              node: <PublishedUrlSection path={path} />,
            },
            { id: 'similar', title: 'Similar notes', node: <SimilarNotesSection path={path} /> },
            { id: 'history', title: 'History', node: <NoteHistorySection path={path} /> },
            { id: 'actions', title: 'Note actions', node: <NoteActionsSection path={path} /> },
          ]}
        />
      </div>
    </div>
  )
}
