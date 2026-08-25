import type { ReactElement } from 'react'
import { dailyPath } from '@reflect/core'
import { DailyEventsSection } from './daily-events-section'
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
 * with a jump-to-today button — then note actions, the day's calendar
 * events, and semantic neighbors. Inbound links live under the note itself
 * (the incoming-backlinks section), not here. Rendered in the AppShell's
 * right region on daily routes only.
 */
export function DailyContextSidebar({ date }: DailyContextSidebarProps): ReactElement {
  const today = useToday()

  return (
    <div className="flex flex-col pt-2 text-text">
      <DayCalendar selectedDate={date} today={today} />
      <div className="my-4 space-y-4 pb-4">
        <NoteActionsSection path={dailyPath(date)} />
        <DailyEventsSection date={date} />
        <PublishedUrlSection path={dailyPath(date)} />
        <SimilarNotesSection path={dailyPath(date)} />
        <NoteHistorySection path={dailyPath(date)} />
      </div>
    </div>
  )
}
