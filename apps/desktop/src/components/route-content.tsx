import { lazy, Suspense, type ReactElement } from 'react'
import { AllNotesScreen } from '@/components/all-notes/all-notes-screen'
import { ChatScreen } from '@/components/chat/chat-screen'
import { DailyStream } from '@/components/daily-stream'
import { SearchRoute } from '@/components/search-route'
import { SingleNoteView } from '@/components/single-note-view'
import { TasksScreen } from '@/components/tasks/tasks-screen'
import { useRouter } from '@/routing/router'
import { ScrollRestored } from '@/routing/scroll-restore'

// The six routes below are reached deliberately, never on boot, and one of
// them (`terminal`) pulls xterm, 345 KB already minified. Statically imported
// they all landed in `desktop-root`, which `warmPlatformRoot` fetches during
// startup. The six eager ones above are the routes the app can open into or
// that a keystroke reaches instantly, so they stay in the boot chunk.
const AgentsScreen = lazy(() =>
  import('@/components/agents/agents-screen').then((module) => ({
    default: module.AgentsScreen,
  })),
)
const BrowserPane = lazy(() =>
  import('@/components/browser/browser-pane').then((module) => ({ default: module.BrowserPane })),
)
const GraphMapScreen = lazy(() =>
  import('@/components/graph-map/graph-map-screen').then((module) => ({
    default: module.GraphMapScreen,
  })),
)
const InsightsScreen = lazy(() =>
  import('@/components/insights/insights-screen').then((module) => ({
    default: module.InsightsScreen,
  })),
)
const SettingsScreen = lazy(() =>
  import('@/components/settings-screen').then((module) => ({ default: module.SettingsScreen })),
)
const TerminalScreen = lazy(() =>
  import('@/components/terminal/terminal-screen').then((module) => ({
    default: module.TerminalScreen,
  })),
)

/**
 * The route → view mapping (Plan 06): the single place a {@link Route} kind
 * becomes a workspace surface. Daily routes render the chronological stream; a
 * `note` route renders one ordinary note as a first-class editable pane (lazy,
 * so ⌘N's fresh path opens before any file exists). Extracted from the
 * workspace shell so this seam — the contract that non-daily notes are just as
 * editable as daily ones — is directly testable. The daily stream owns live
 * today tracking so route arrivals and the highlighted current day use the
 * same clock.
 */
export function RouteContent(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RouteView />
    </Suspense>
  )
}

/**
 * The switch itself. Split out so the `Suspense` boundary wraps every branch
 * without indenting the whole mapping, and so a lazy branch cannot be added
 * without one. `null` is the right fallback: these routes are opened
 * deliberately, and a spinner for one frame reads as jank rather than progress.
 */
function RouteView(): ReactElement {
  const { route } = useRouter()
  switch (route.kind) {
    case 'today':
      return <DailyStream target={{ kind: 'today' }} />
    case 'daily':
      // The router normalizes daily routes (see normalizeRoute), so the date
      // is a real calendar day by the time it reaches a view.
      return <DailyStream target={{ kind: 'date', date: route.date }} />
    case 'note':
      return <SingleNoteView path={route.path} />
    case 'allNotes':
      // Owns its scroll container (virtualized table + fixed header), so no
      // ScrollRestored wrapper — same shape as the daily stream.
      return <AllNotesScreen tag={route.tag} />
    case 'tasks':
      // Owns its scroll container (a grouped list with a fixed header), so no
      // ScrollRestored wrapper — same shape as All Notes.
      return <TasksScreen />
    case 'search':
      return <SearchRoute query={route.query} />
    case 'chat':
      // Owns its scroll container (the message list pins to the bottom while
      // streaming), so no ScrollRestored wrapper — same shape as All Notes.
      return <ChatScreen />
    case 'insights':
      return (
        <ScrollRestored className="h-full overflow-auto">
          <InsightsScreen />
        </ScrollRestored>
      )
    case 'graphMap':
      // Owns its surface (a pan/zoom canvas), so no scroll wrapper.
      return <GraphMapScreen />
    case 'terminal':
      return <TerminalScreen />
    case 'browser':
      // Owns no scroll container — the embedded webview covers its host.
      return <BrowserPane />
    case 'agents':
      return (
        <ScrollRestored className="h-full overflow-auto px-6 py-8">
          <AgentsScreen />
        </ScrollRestored>
      )
    case 'graphs':
    // The graph-switcher route is a mobile settings sub-screen; on desktop
    // graph switching lives in the sidebar footer, so it renders as settings.
    case 'settings':
      // Settings owns its full-height page shell and independent content scroll.
      return <SettingsScreen />
  }
}
