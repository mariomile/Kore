import { lazy, Suspense, useState, type ReactElement, type ReactNode } from 'react'
import {
  CalendarDays,
  Chat,
  Close,
  Globe,
  Info,
  Plus,
  Terminal,
  type Icon,
} from '@/components/icons'
import { ChatScreen } from '@/components/chat/chat-screen'
import { tabCloseClass, tabPillClass, useTabScrollIntoView } from '@/components/tab-pill'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Lazy here too, or this edge survives the route split: the sidebar can host
// the terminal and browser panes, so a static import from here would pull xterm
// and the browser pane back into the boot chunk regardless of what
// route-content.tsx does.
const BrowserPane = lazy(() =>
  import('@/components/browser/browser-pane').then((module) => ({ default: module.BrowserPane })),
)
const TerminalScreen = lazy(() =>
  import('@/components/terminal/terminal-screen').then((module) => ({
    default: module.TerminalScreen,
  })),
)
import { haptic } from '@/lib/haptics'
import { useToday } from '@/lib/use-today'
import { cn } from '@/lib/utils'
import { DailyContextSidebar } from './daily-context-sidebar'
import { DailyEventsSection } from './daily-events-section'
import { DayCalendar } from './day-calendar'
import { NoteContextSidebar } from './note-context-sidebar'
import { NotePeek } from './note-peek'
import { usePeekPath } from '@/lib/selection/peek-store'
import type { ContextSidebarTarget } from './sidebar-route'

type ContextPanel = 'details' | 'chat' | 'calendar' | 'browser' | 'terminal'

/**
 * The one panel the rail always carries. Every other panel is opt-in through
 * the "+" menu, so the default switcher is a single glyph rather than a row
 * of five — the rail opens on what the route is already about.
 */
const DEFAULT_PANEL: ContextPanel = 'details'

/** What a panel's body gets to describe: the route's note, and the day. */
interface PanelContext {
  target: ContextSidebarTarget | null
  /** The row a list is pointing at — the side peek — on routes without a note. */
  peekPath: string | null
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
    render: ({ target, peekPath }) =>
      target === null ? (
        peekPath === null ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">
            Open a note to see its details here.
          </div>
        ) : (
          <NotePeek path={peekPath} />
        )
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
    render: () => (
      <Suspense fallback={null}>
        <BrowserPane />
      </Suspense>
    ),
  },
  {
    id: 'terminal',
    label: 'Terminal',
    Glyph: Terminal,
    ownsScrolling: true,
    // The same PTY as the terminal route's.
    render: () => (
      <Suspense fallback={null}>
        <TerminalScreen />
      </Suspense>
    ),
  },
]

/** The panels the "+" menu offers — everything the rail does not start with. */
const OPTIONAL_PANELS = PANELS.filter((spec) => spec.id !== DEFAULT_PANEL)

interface ContextSidebarProps {
  /** What the Details panel describes — null on routes without a note. */
  target: ContextSidebarTarget | null
}

/**
 * The right-hand workspace sidebar: a switcher band over a floating card,
 * the same two-part shape as the content column's tab strip over the
 * note-pane card. A liquid-glass icon switcher picks which of {@link PANELS}
 * fills the card, and starts as Details alone plus the "+" that adds the
 * rest. What the "+" opens is a real tab: it stays on the band until you
 * close it, and only Details cannot be closed. Both the open set and the
 * choice are per-window session state, not persisted.
 */
export function ContextSidebar({ target }: ContextSidebarProps): ReactElement {
  const [opened, setOpened] = useState<ContextPanel[]>([])
  const [panel, setPanel] = useState<ContextPanel>(DEFAULT_PANEL)
  const today = useToday()
  const peekPath = usePeekPath()
  // The calendar panel anchors on the described day when there is one, so it
  // matches what the Details panel would show on a daily route.
  const calendarDate = target?.kind === 'daily' ? target.date : today
  // Segments keep `PANELS` order however the panels were opened, so the band
  // never reshuffles itself around the glyph you are aiming at.
  const segments = PANELS.filter((spec) => spec.id === DEFAULT_PANEL || opened.includes(spec.id))
  const active = segments.find((spec) => spec.id === panel) ?? segments[0]!

  const selectPanel = (id: ContextPanel): void => {
    if (id !== panel) {
      haptic('alignment')
      setPanel(id)
    }
  }

  /** Opening a panel from the "+" also brings it up; re-picking an open one just shows it. */
  const openPanel = (id: ContextPanel): void => {
    haptic('alignment')
    if (!opened.includes(id)) {
      setOpened([...opened, id])
    }
    setPanel(id)
  }

  /** Closing the tab on screen falls back to Details, the one tab that never closes. */
  const closePanel = (id: ContextPanel): void => {
    haptic('alignment')
    setOpened(opened.filter((entry) => entry !== id))
    if (panel === id) {
      setPanel(DEFAULT_PANEL)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The switcher rides the same 44px top band as the tab strip and the
          sidebar search — one optical line across the window. On macOS the
          band doubles as title-bar drag area; the switcher itself is lifted
          above the WindowDragRegion strip so its segments stay clickable. */}
      <div data-tauri-drag-region className="flex h-11 flex-none items-center px-3">
        {/* The tabs run from the rail's left edge, the same direction the
            content column's strip fills, with the "+" trailing the last one
            rather than the row centering itself around them. */}
        <div className="window-drag-control flex w-full items-center justify-start gap-1">
          <div
            role="tablist"
            aria-label="Context panels"
            // Scrolls rather than clipping once the pills can give up no more
            // width — the same overflow the content strip's tab row has.
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            {segments.map((spec) => (
              <PanelTab
                key={spec.id}
                spec={spec}
                active={panel === spec.id}
                onSelect={selectPanel}
                onClose={spec.id === DEFAULT_PANEL ? undefined : closePanel}
              />
            ))}
          </div>

          <ContextPanelsPlusMenu onOpen={openPanel} />
        </div>
      </div>

      {/* The rail's own card, sunken off the window edges exactly like the
          note pane's. Its left gutter is also the resize handle's lane: the
          embedded browser's native child webview covers the card, so a
          divider sharing those pixels would be unreachable whenever the
          Browser panel is up. */}
      <div
        data-testid="context-pane-gutter"
        className="workspace-pane-gutter min-h-0 flex-1 pl-2 pb-2"
      >
        <div className="app-glass-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-surface">
          <div
            className={cn(
              'min-h-0 flex-1',
              active.ownsScrolling ? 'flex flex-col' : 'overflow-y-auto',
            )}
          >
            {active.render({ target, peekPath, calendarDate, today })}
          </div>
        </div>
      </div>
    </div>
  )
}

interface PanelTabProps {
  spec: ContextPanelSpec
  active: boolean
  onSelect: (id: ContextPanel) => void
  /** Left out for Details, the tab the rail always carries. */
  onClose?: ((id: ContextPanel) => void) | undefined
}

/**
 * One tab on the switcher band — the same pill the content column's strip
 * draws (`tabPillClass`), carrying the panel's glyph, its name, and the close
 * that takes it back off the band. The close is noise on every tab at once, so
 * it belongs to the tab you are pointing at or the one already on screen — and
 * middle-click closes without aiming at it, as it does on the content strip.
 */
function PanelTab({
  spec: { id, label, Glyph },
  active,
  onSelect,
  onClose,
}: PanelTabProps): ReactElement {
  const scrollRef = useTabScrollIntoView<HTMLDivElement>(active)
  return (
    <div
      ref={scrollRef}
      // Presentational so the tablist still sees tabs, not wrappers: the pill
      // is the box the label and the close share, and its own name would
      // otherwise swallow both.
      role="presentation"
      className={cn(tabPillClass(active), 'group cursor-default', onClose && 'pr-1')}
      onAuxClick={(event) => {
        if (onClose && event.button === 1) {
          event.preventDefault()
          onClose(id)
        }
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={label}
        onClick={() => {
          onSelect(id)
        }}
        // The tabs have to fit the rail's 240px minimum, so the label gives up
        // width before the row overflows.
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Glyph aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
          onClick={() => {
            onClose(id)
          }}
          className={tabCloseClass(active)}
        >
          <Close aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

interface ContextPanelsPlusMenuProps {
  onOpen: (id: ContextPanel) => void
}

/**
 * The switcher's "+": every panel the rail does not start with. Picking one
 * gives it a tab and brings it up; picking one that already has a tab just
 * shows it, since the tab itself is what closes it again.
 */
function ContextPanelsPlusMenu({ onOpen }: ContextPanelsPlusMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Open a panel"
            title="Open a panel"
            // The same quiet round button the content strip's "+" is, and it
            // never gives up its width: it is the only way back to the panels
            // the band is not carrying.
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-surface-hover hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-44">
        {OPTIONAL_PANELS.map(({ id, label, Glyph }) => (
          <DropdownMenuItem
            key={id}
            onClick={() => {
              onOpen(id)
            }}
          >
            <Glyph aria-hidden className="size-3.5" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
