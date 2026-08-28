import { useState, type ReactElement, type ReactNode } from 'react'
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

/** What a panel's body gets to describe: the route's note, and the day. */
interface PanelContext {
  target: ContextSidebarTarget | null
  /** The day the Calendar panel anchors on. */
  calendarDate: string
  today: string
}

interface ContextPanelSpec {
  id: ContextPanel
  label: string
  Glyph: Icon
  /**
   * True when the panel scrolls its own content — the chat's turn list,
   * xterm, the embedded webview covering its host. Those get the raw flex
   * column; everything else gets the rail's scroller.
   */
  ownsScrolling: boolean
  render: (context: PanelContext) => ReactNode
}

/**
 * Every panel the rail can show, in switcher order. One row is the whole
 * definition — its tab and its body — so the two can never disagree about
 * which panels exist. Tags are the left rail's section and appear only there.
 */
const PANELS: ContextPanelSpec[] = [
  {
    id: 'details',
    label: 'Details',
    Glyph: Info,
    ownsScrolling: false,
    render: ({ target }) =>
      target === null ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">
          Open a note to see its details here.
        </div>
      ) : target.kind === 'daily' ? (
        <DailyContextSidebar date={target.date} />
      ) : (
        <NoteContextSidebar path={target.path} />
      ),
  },
  {
    id: 'chat',
    label: 'Chat',
    Glyph: Chat,
    ownsScrolling: true,
    // The same graph-grounded session as the chat route, so the conversation
    // follows you between both surfaces. It does not take focus here: the
    // rail is auxiliary and the caret belongs to whatever you were editing.
    render: () => <ChatScreen autoFocus={false} />,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    Glyph: CalendarDays,
    ownsScrolling: false,
    render: ({ calendarDate, today }) => (
      <div className="flex flex-col pt-2 text-text">
        <DayCalendar selectedDate={calendarDate} today={today} />
        <div className="my-4 space-y-4 pb-4">
          <DailyEventsSection date={calendarDate} />
        </div>
      </div>
    ),
  },
  {
    id: 'browser',
    label: 'Browser',
    Glyph: Globe,
    ownsScrolling: true,
    // Shares its session with the browser tab.
    render: () => <BrowserPane />,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    Glyph: Terminal,
    ownsScrolling: true,
    // The same PTY as the terminal route's.
    render: () => <TerminalScreen />,
  },
]

interface ContextSidebarProps {
  /** What the Details panel describes — null on routes without a note. */
  target: ContextSidebarTarget | null
}

/**
 * The right-hand workspace sidebar: a switcher band over a floating card,
 * the same two-part shape as the content column's tab strip over the
 * note-pane card. A liquid-glass icon switcher picks which of {@link PANELS}
 * fills the card. The choice is per-window session state, not persisted.
 */
export function ContextSidebar({ target }: ContextSidebarProps): ReactElement {
  const [panel, setPanel] = useState<ContextPanel>('details')
  const today = useToday()
  // The calendar panel anchors on the described day when there is one, so it
  // matches what the Details panel would show on a daily route.
  const calendarDate = target?.kind === 'daily' ? target.date : today
  const active = PANELS.find((spec) => spec.id === panel) ?? PANELS[0]!

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
      <div data-testid="context-pane-gutter" className="min-h-0 flex-1 pl-2 pb-2">
        <div className="app-glass-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-surface">
          <div
            className={cn(
              'min-h-0 flex-1',
              active.ownsScrolling ? 'flex flex-col' : 'overflow-y-auto',
            )}
          >
            {active.render({ target, calendarDate, today })}
          </div>
        </div>
      </div>
    </div>
  )
}
