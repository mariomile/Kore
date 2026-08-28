import { useState, type ReactElement } from 'react'
import { CalendarDays, Chat, Globe, Info, Terminal, type Icon } from '@/components/icons'
import { BrowserPane } from '@/components/browser/browser-pane'
import { ChatScreen } from '@/components/chat/chat-screen'
import { SidebarIconSlot } from '@/components/sidebar/sidebar-icon-slot'
import { TerminalScreen } from '@/components/terminal/terminal-screen'
import { haptic } from '@/lib/haptics'
import { useToday } from '@/lib/use-today'
import { cn } from '@/lib/utils'
import { DailyContextSidebar } from './daily-context-sidebar'
import { DailyEventsSection } from './daily-events-section'
import { DayCalendar } from './day-calendar'
import { NoteContextSidebar } from './note-context-sidebar'
import type { ContextSidebarTarget } from './sidebar-route'

type ContextPanel = 'details' | 'chat' | 'calendar' | 'browser' | 'terminal'

const PANELS: { id: ContextPanel; label: string; Glyph: Icon }[] = [
  { id: 'details', label: 'Details', Glyph: Info },
  { id: 'chat', label: 'Chat', Glyph: Chat },
  { id: 'calendar', label: 'Calendar', Glyph: CalendarDays },
  { id: 'browser', label: 'Browser', Glyph: Globe },
  { id: 'terminal', label: 'Terminal', Glyph: Terminal },
]

interface ContextSidebarProps {
  /** What the Details panel describes — null on routes without a note. */
  target: ContextSidebarTarget | null
}

/**
 * The right-hand workspace sidebar: a switcher band over a floating card,
 * the same two-part shape as the content column's tab strip over the
 * note-pane card. A liquid-glass icon switcher picks the panel — Details
 * (the route's contextual sidebar: calendar, actions, events, similar
 * notes), Chat (the same graph-grounded session as the chat route, so the
 * conversation follows you between both surfaces), Calendar (the month at a
 * glance with the day's events, on any route), Browser (the built-in
 * browser, sharing its session with the browser tab), or Terminal (the same
 * PTY as the terminal route). Tags are the left rail's section and appear
 * only there. The panel choice is per-window session state, not persisted.
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
        {/* The segments cluster centered at a fixed width instead of
            stretching across the rail, so the glyphs stay close together at
            any panel width. */}
        <div
          role="tablist"
          aria-label="Context panels"
          className="window-drag-control flex w-full items-center justify-center gap-1"
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
                // The segments have to fit the rail's 240px minimum, so they
                // give up width before the row overflows.
                'flex h-8 min-w-0 max-w-10 flex-1 items-center justify-center rounded-lg transition-colors duration-150 ease-swift',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              )}
            >
              <SidebarIconSlot>
                <Glyph className="size-[17px]" />
              </SidebarIconSlot>
            </button>
          ))}
        </div>
      </div>

      {/* The rail's own card, sunken off the window edges exactly like the
          note pane's. Its left gutter is also the resize handle's lane: the
          embedded browser's native child webview covers the card, so a
          divider sharing those pixels would be unreachable whenever the
          Browser panel is up. */}
      <div data-testid="context-pane-gutter" className="min-h-0 flex-1 px-2 pb-2">
        <div className="app-glass-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-surface">
          {panel === 'chat' ? (
            // Chat owns its scrolling (the turn list) and pins its composer
            // to the bottom, so it gets the raw flex column instead of a
            // scroller. It does not take focus here: the rail is auxiliary
            // and the caret belongs to whatever you were editing.
            <div className="flex min-h-0 flex-1 flex-col">
              <ChatScreen autoFocusComposer={false} />
            </div>
          ) : panel === 'browser' ? (
            // The browser owns its region (the embedded webview covers its
            // host), so no scroller — same shared session as the browser tab.
            <div className="flex min-h-0 flex-1 flex-col">
              <BrowserPane />
            </div>
          ) : panel === 'terminal' ? (
            // The terminal owns its region too (xterm scrolls itself); the
            // PTY is the same session as the terminal route's.
            <div className="flex min-h-0 flex-1 flex-col">
              <TerminalScreen />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
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
      </div>
    </div>
  )
}
