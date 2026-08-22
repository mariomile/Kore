import { useState, type ReactElement } from 'react'
import { ChatScreen } from '@/components/chat/chat-screen'
import { SidebarGlassTile } from '@/components/sidebar/sidebar-glass-tile'
import { CalendarGlyph, ChatGlyph, InfoGlyph } from '@/components/sidebar/sidebar-nav-icons'
import { haptic } from '@/lib/haptics'
import { useToday } from '@/lib/use-today'
import { cn } from '@/lib/utils'
import { DailyContextSidebar } from './daily-context-sidebar'
import { DailyEventsSection } from './daily-events-section'
import { DayCalendar } from './day-calendar'
import { NoteContextSidebar } from './note-context-sidebar'
import type { ContextSidebarTarget } from './sidebar-route'

type ContextPanel = 'details' | 'chat' | 'calendar'

const PANELS: { id: ContextPanel; label: string; Glyph: typeof InfoGlyph }[] = [
  { id: 'details', label: 'Details', Glyph: InfoGlyph },
  { id: 'chat', label: 'Chat', Glyph: ChatGlyph },
  { id: 'calendar', label: 'Calendar', Glyph: CalendarGlyph },
]

interface ContextSidebarProps {
  /** What the Details panel describes — null on routes without a note. */
  target: ContextSidebarTarget | null
}

/**
 * The right-hand workspace sidebar: a full-height rail beside the floating
 * note-pane card, mirroring the left sidebar. A liquid-glass icon switcher
 * at the top picks its panel — Details (the route's contextual sidebar:
 * calendar, actions, events, similar notes), Chat (the same graph-grounded
 * session as the chat route, so the conversation follows you between both
 * surfaces), or Calendar (the month at a glance with the day's events, on
 * any route). The panel choice is per-window session state, not persisted.
 */
export function ContextSidebar({ target }: ContextSidebarProps): ReactElement {
  const [panel, setPanel] = useState<ContextPanel>('details')
  const today = useToday()
  // The calendar panel anchors on the described day when there is one, so it
  // matches what the Details panel would show on a daily route.
  const calendarDate = target?.kind === 'daily' ? target.date : today

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The switcher rides the same 44px top band as the tab strip and the
          sidebar search — one optical line across the window. On macOS the
          band doubles as title-bar drag area; the switcher itself is lifted
          above the WindowDragRegion strip so its segments stay clickable. */}
      <div data-tauri-drag-region className="flex h-11 flex-none items-center px-3">
        <div
          role="tablist"
          aria-label="Context panels"
          className="window-drag-control flex w-full items-center gap-1"
        >
          {PANELS.map(({ id, label, Glyph }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={panel === id}
              aria-label={label}
              title={label}
              onClick={() => {
                if (id !== panel) {
                  haptic('alignment')
                }
                setPanel(id)
              }}
              className={cn(
                'flex h-8 flex-1 items-center justify-center rounded-lg transition-colors duration-150 ease-swift',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              )}
            >
              <SidebarGlassTile>
                <Glyph />
              </SidebarGlassTile>
            </button>
          ))}
        </div>
      </div>

      {panel === 'chat' ? (
        // Chat owns its scrolling (the turn list) and pins its composer to
        // the bottom, so it gets the raw flex column instead of a scroller.
        <div className="mt-1 flex min-h-0 flex-1 flex-col">
          <ChatScreen />
        </div>
      ) : (
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
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
