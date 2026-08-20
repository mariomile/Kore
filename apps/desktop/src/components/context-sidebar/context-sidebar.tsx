import { useState, type ReactElement } from 'react'
import { CalendarDays, Info, MessageSquare } from 'lucide-react'
import { ChatScreen } from '@/components/chat/chat-screen'
import { useToday } from '@/lib/use-today'
import { cn } from '@/lib/utils'
import { hasMacosTitleBarOverlay } from '@/lib/window-chrome'
import { DailyContextSidebar } from './daily-context-sidebar'
import { DailyEventsSection } from './daily-events-section'
import { DayCalendar } from './day-calendar'
import { NoteContextSidebar } from './note-context-sidebar'
import type { ContextSidebarTarget } from './sidebar-route'

type ContextPanel = 'details' | 'chat' | 'calendar'

const PANELS: { id: ContextPanel; label: string; icon: typeof Info }[] = [
  { id: 'details', label: 'Details', icon: Info },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
]

interface ContextSidebarProps {
  /** What the Details panel describes — null on routes without a note. */
  target: ContextSidebarTarget | null
}

/**
 * The right-hand workspace sidebar: a full-height rail beside the floating
 * note-pane card, mirroring the left sidebar. A segmented switcher at the top
 * picks its panel — Details (the route's contextual sidebar: calendar,
 * actions, events, similar notes), Chat (the same graph-grounded session as
 * the chat route, so the conversation follows you between both surfaces), or
 * Calendar (the month at a glance with the day's events, on any route). The
 * panel choice is per-window session state, not persisted.
 */
export function ContextSidebar({ target }: ContextSidebarProps): ReactElement {
  const [panel, setPanel] = useState<ContextPanel>('details')
  const today = useToday()
  // The calendar panel anchors on the described day when there is one, so it
  // matches what the Details panel would show on a daily route.
  const calendarDate = target?.kind === 'daily' ? target.date : today

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        // Like the left sidebar, the rail runs the full window height — on
        // macOS the switcher must clear the WindowDragRegion strip.
        hasMacosTitleBarOverlay ? 'pt-9' : 'pt-3',
      )}
    >
      <div role="tablist" aria-label="Context panels" className="mx-3 flex flex-none gap-1">
        {PANELS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            aria-label={label}
            title={label}
            onClick={() => {
              setPanel(id)
            }}
            className={cn(
              // Icon-only tabs; the wide flex-1 hit area keeps them easy to
              // reach while the label lives in the tooltip and aria-label.
              'flex h-7 flex-1 items-center justify-center rounded-md',
              panel === id
                ? 'border border-border bg-surface text-text shadow-sm'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text',
            )}
          >
            <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
          </button>
        ))}
      </div>

      {panel === 'chat' ? (
        // Chat owns its scrolling (the turn list) and pins its composer to
        // the bottom, so it gets the raw flex column instead of a scroller.
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <ChatScreen />
        </div>
      ) : (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {panel === 'details' ? (
            target === null ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">
                Open a note to see its details here.
              </div>
            ) : target.kind === 'daily' ? (
              <DailyContextSidebar date={target.date} />
            ) : (
              <NoteContextSidebar path={target.path} />
            )
          ) : (
            <div className="flex flex-col pt-2 text-text">
              <DayCalendar selectedDate={calendarDate} today={today} />
              <div className="my-4 space-y-4 pb-4">
                <DailyEventsSection date={calendarDate} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
