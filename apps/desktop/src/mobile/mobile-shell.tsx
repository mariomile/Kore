import { useEffect, useRef, useState, type ReactElement } from 'react'
import { untitledNotePath } from '@kore/core'
import { useDoubleTap } from '@/hooks/use-double-tap'
import { useMobileAudioMemo } from '@/mobile/audio-memo-provider'
import { useBlockSelection } from '@/editor/block-selection-store'
import { MobileBlockActionBar } from '@/mobile/block-action-bar'
import { MobileCaptureDrawer } from '@/mobile/capture-drawer'
import { MobileFormattingToolbar } from '@/mobile/formatting-toolbar'
import { GlobalSearchSheet } from '@/mobile/global-search-sheet'
import { MobileStack } from '@/mobile/mobile-stack'
import { MobileTabBar, tabRootFor, type MobileTab } from '@/mobile/mobile-tab-bar'
import {
  EMPTY_ALL_NOTES_FILTERS,
  folderSearchQuery,
  type AllNotesFilters,
} from '@/mobile/search-filters/filter-state'
import { useKeyboardVisible } from '@/mobile/use-keyboard'
import { PullToSearchIndicator, usePullToSearch } from '@/mobile/pull-to-search'
import { useWakeToToday } from '@/mobile/use-wake-to-today'
import { routesEqual, type Route } from '@/routing/route'
import { useRouter } from '@/routing/router'

type DailyRoute = Extract<Route, { kind: 'today' }> | Extract<Route, { kind: 'daily' }>

function dailyRouteFrom(route: Route): DailyRoute | null {
  return route.kind === 'today' || route.kind === 'daily' ? route : null
}

/** Screens where a pull from the top opens global search. */
function pullToSearchRoute(route: Route): boolean {
  return (
    route.kind === 'today' ||
    route.kind === 'daily' ||
    route.kind === 'tasks' ||
    route.kind === 'note'
  )
}

/**
 * The tabbed mobile shell (Plan 19, V1 parity): screens above, the
 * Daily / All bar below. The active tab derives from the route — a note
 * keeps whichever tab it was opened from, so reading a search result
 * doesn't flip the bar. The All tab's search text and filter badges live
 * here, not in the screen, so opening a note and coming back loses neither.
 */
export function MobileShell(): ReactElement {
  const { route, navigate, entryId } = useRouter()
  const audioMemo = useMobileAudioMemo()
  const [allQuery, setAllQuery] = useState('')
  const [allFilters, setAllFilters] = useState<AllNotesFilters>(EMPTY_ALL_NOTES_FILTERS)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [newTaskRequested, setNewTaskRequested] = useState(false)
  const [lastTab, setLastTab] = useState<MobileTab>('daily')
  const [lastDailyRoute, setLastDailyRoute] = useState<DailyRoute>({
    kind: 'today',
  })
  // A tab double-tap is a capture gesture (Daily focuses today's editor; list
  // and chat tabs focus their primary inputs); a pending tap expires if the
  // route leaves the tab's root between taps — that second tap is a return,
  // not a double-tap.
  const isDoubleTap = useDoubleTap<MobileTab>(tabRootFor(route))
  const keyboardVisible = useKeyboardVisible()
  const blockSelection = useBlockSelection()
  // V1's wake-to-today: foregrounding on a new calendar date lands on today.
  useWakeToToday()

  // Pull down from the top of a screen for global search. Not on the All tab
  // (its search field is already the first thing on screen), Chat (its own
  // composer) or Settings, and never while typing or selecting blocks.
  const stackRef = useRef<HTMLDivElement | null>(null)
  const pullIndicatorRef = useRef<HTMLDivElement | null>(null)
  usePullToSearch({
    container: stackRef,
    indicator: pullIndicatorRef,
    enabled: !searchOpen && !keyboardVisible && blockSelection === null && pullToSearchRoute(route),
    onOpen: () => setSearchOpen(true),
  })

  // A `search` history entry seeds the live query — once per entry, so the
  // user can keep typing without the effect snapping the text back. A folder
  // route (the breadcrumb above a note title) has no iPhone page of its own:
  // it seeds the folder's `path:` query the same way.
  const seededEntry = useRef<number | null>(null)
  const seedQuery =
    route.kind === 'search'
      ? route.query
      : route.kind === 'allNotes' && route.filter.kind === 'folder'
        ? folderSearchQuery(route.filter.folder)
        : null
  useEffect(() => {
    if (seedQuery !== null && seededEntry.current !== entryId) {
      seededEntry.current = entryId
      setAllQuery(seedQuery)
    }
  }, [seedQuery, entryId])

  // A note keeps whichever tab it was opened from: routes that don't map to a
  // tab fall back to the last one, remembered across renders. Tracking that in
  // state (adjusted during render) avoids reading/writing a ref in render.
  const tab: MobileTab = tabRootFor(route) ?? lastTab
  const currentDailyRoute = dailyRouteFrom(route)
  if (tab !== lastTab) {
    setLastTab(tab)
  }
  if (currentDailyRoute !== null && !routesEqual(currentDailyRoute, lastDailyRoute)) {
    setLastDailyRoute(currentDailyRoute)
  }

  const handleTabSelect = (next: MobileTab): void => {
    const doubleTap = isDoubleTap(next)

    if (next === 'all') {
      // The double-tap is a search gesture: land on the tab with its search
      // input focused (the Daily tab's capture double-tap, All-flavored).
      navigate(
        { kind: 'allNotes', filter: { kind: 'all' } },
        doubleTap ? { focusEditor: true } : undefined,
      )
      return
    }

    if (next === 'tasks') {
      navigate({ kind: 'tasks' }, doubleTap ? { focusEditor: true } : undefined)
      return
    }

    if (next === 'chat') {
      navigate({ kind: 'chat' }, doubleTap ? { focusEditor: true } : undefined)
      return
    }

    if (doubleTap) {
      navigate({ kind: 'today' }, { focusEditor: true })
      return
    }

    if (currentDailyRoute !== null) {
      return
    }
    navigate(lastDailyRoute, { restoreSurfaceScroll: true })
  }

  return (
    // The shell yields to the software keyboard by height (Plan 19,
    // decision 8): the root ends at the keyboard's top, so every screen's
    // layout — and floating-ui's positioning boundary (`body`), which sizes
    // the editor's autocomplete menus — sees the true visible viewport.
    // Only `position: fixed` elements need `--keyboard-height` themselves.
    <div
      className="flex w-screen flex-col"
      style={{ height: 'calc(100dvh - var(--keyboard-height, 0px))' }}
    >
      <div ref={stackRef} className="relative min-h-0 flex-1">
        <PullToSearchIndicator ref={pullIndicatorRef} />
        <MobileStack
          allQuery={allQuery}
          onAllQueryChange={setAllQuery}
          allFilters={allFilters}
          onAllFiltersChange={setAllFilters}
          newTaskRequested={newTaskRequested}
          onNewTaskConsumed={() => setNewTaskRequested(false)}
        />
        {/* The tab bar floats over the stack as a translucent glass bar —
            screens pad their scrollers past `--mobile-tab-bar-height`, so
            content scrolls under it rather than stopping above. */}
        {keyboardVisible ? null : blockSelection !== null ? (
          <MobileBlockActionBar selection={blockSelection} />
        ) : (
          <MobileTabBar
            tab={tab}
            onSelect={handleTabSelect}
            onCapture={() => setCaptureOpen(true)}
          />
        )}
      </div>
      {/* V1 lets the keyboard cover the tab bar; with the root shrunk it
          would ride above the keyboard instead, so it hides while typing.
          Its slot goes to the formatting toolbar, which — sitting at the
          bottom of a root that ends at the keyboard's top — lands exactly
          on the keyboard edge with no fixed positioning. */}
      {keyboardVisible ? <MobileFormattingToolbar /> : null}
      <MobileCaptureDrawer
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        // The same one-shot capture arrival as ⌘D and the Daily-tab
        // double-tap: today's editor focused with the caret at the end of
        // its content, ready to append.
        onDaily={() => navigate({ kind: 'today' }, { focusEditor: true })}
        // A typed line arrives as the note it just created; the empty-field
        // shortcut opens a fresh untitled note whose H1 takes the caret.
        onNote={(path) => navigate({ kind: 'note', path: path ?? untitledNotePath() })}
        onTask={() => {
          setNewTaskRequested(true)
          navigate({ kind: 'tasks' })
        }}
        onRecord={audioMemo.toggle}
        recordingAvailable={audioMemo.available}
      />
      {searchOpen ? <GlobalSearchSheet onClose={() => setSearchOpen(false)} /> : null}
    </div>
  )
}
