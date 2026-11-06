import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import { PaneErrorBoundary } from '@/components/pane-error-boundary'
import { ChatScreen } from '@/components/chat/chat-screen'
import { DailyStream } from '@/components/daily-stream'
import { SearchRoute } from '@/components/search-route'
import { SingleNoteView } from '@/components/single-note-view'
import { useRouter } from '@/routing/router'
import { ScrollRestored } from '@/routing/scroll-restore'

// The routes below are reached deliberately, never on boot, and one of them
// (`terminal`) pulls xterm, 345 KB already minified. Statically imported they
// all landed in `desktop-root`, which `warmPlatformRoot` fetches during
// startup. The four eager ones above are the routes the app opens into (the
// daily stream, a note, a search hand-off) and the chat the right rail shows,
// so they stay in the boot chunk. All Notes and Tasks are one keystroke away,
// so their chunks are fetched once the first screen has painted
// ({@link prefetchKeystrokeRoutes}) and the keystroke still lands instantly.
const loadAllNotesScreen = () => import('@/components/all-notes/all-notes-screen')
const loadTasksScreen = () => import('@/components/tasks/tasks-screen')
const AllNotesScreen = lazy(() =>
  loadAllNotesScreen().then((module) => ({ default: module.AllNotesScreen })),
)
const TasksScreen = lazy(() =>
  loadTasksScreen().then((module) => ({ default: module.TasksScreen })),
)
const BaseScreen = lazy(() =>
  import('@/components/bases/base-screen').then((module) => ({ default: module.BaseScreen })),
)
const CanvasScreen = lazy(() =>
  import('@/components/canvas/canvas-screen').then((module) => ({
    default: module.CanvasScreen,
  })),
)
const BrowserPane = lazy(() =>
  import('@/components/browser/browser-pane').then((module) => ({ default: module.BrowserPane })),
)
const LocalGraphScreen = lazy(() =>
  import('@/components/context-sidebar/local-graph-screen').then((module) => ({
    default: module.LocalGraphScreen,
  })),
)
const LibraryFileScreen = lazy(() =>
  import('@/components/library/library-file-screen').then((module) => ({
    default: module.LibraryFileScreen,
  })),
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
 * same clock. Every route renders inside a {@link PaneErrorBoundary}, so a
 * crash in one note or view stays in its pane instead of blanking the app.
 */
export function RouteContent(): ReactElement {
  const { route } = useRouter()
  useEffect(() => prefetchKeystrokeRoutes(), [])
  return (
    <PaneErrorBoundary
      resetKey={JSON.stringify(route)}
      surface={route.kind}
      path={'path' in route ? route.path : null}
    >
      <Suspense fallback={null}>
        <RouteView />
      </Suspense>
    </PaneErrorBoundary>
  )
}

// Long enough for the first screen to paint and settle, short enough that a
// user reaching for ⌘-shortcuts right after launch rarely beats it.
const KEYSTROKE_ROUTE_PREFETCH_DELAY_MS = 1500

/**
 * Fetch the keystroke-reachable lazy routes off the boot path, once. Returns
 * the cleanup that cancels a prefetch that has not started yet.
 */
function prefetchKeystrokeRoutes(): () => void {
  const timer = window.setTimeout(() => {
    void loadAllNotesScreen()
    void loadTasksScreen()
  }, KEYSTROKE_ROUTE_PREFETCH_DELAY_MS)
  return () => window.clearTimeout(timer)
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
      return <AllNotesScreen filter={route.filter} />
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
      // Keyed by the focus so a new hand-off starts from that note's
      // neighborhood instead of whatever the screen was showing.
      return <GraphMapScreen key={route.focus ?? ''} focus={route.focus ?? null} />
    case 'terminal':
      return <TerminalScreen />
    case 'browser':
      // Owns no scroll container — the embedded webview covers its host.
      return <BrowserPane />
    case 'base':
      // Owns its scroll container (wide tables scroll sideways inside it).
      return <BaseScreen path={route.path} view={route.view} />
    case 'canvas':
      // Owns its viewport: panning and zooming replace scrolling.
      return <CanvasScreen path={route.path} />
    case 'localGraph':
      // Owns its surface, like the full graph map.
      return <LocalGraphScreen key={route.path} path={route.path} />
    case 'library':
      // Owns its scroll container, like a base.
      return <LibraryFileScreen root={route.root} path={route.path} />
    case 'graphs':
    // The graph-switcher route is a mobile settings sub-screen; on desktop
    // graph switching lives in the sidebar footer, so it renders as the
    // same full-page settings workspace.
    case 'settings':
      // Settings owns the window: a local sidebar and independent content
      // scroll, covering the workspace chrome rather than joining the strip.
      return <SettingsScreen />
  }
}
