import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react'
import { isDaily, isTemplatePath, isUntitledNotePath, type OpenNoteTab } from '@reflect/core'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * The open-notes model behind both tab surfaces (the strip over the note pane
 * and the sidebar's Open section — design options A + B). One ordered list of
 * open note tabs per graph, persisted in settings (`openNoteTabs`, keyed by
 * graph root — the settings document is global, and unkeyed tabs would leak
 * into other graphs and be pruned away there) so a relaunch restores the
 * session. Daily notes are never tabs: the Daily view is the fixed "tab zero"
 * every surface renders itself, always first and never closable — so `tabs`
 * here holds ordinary notes only.
 */

export interface OpenTabsValue {
  /** Open note tabs in strip order (pinned first). */
  tabs: OpenNoteTab[]
  /** The tab the current route addresses, or null (daily view, other screens). */
  activePath: string | null
  /** True while the route is the daily view — the fixed tab zero. */
  isDailyActive: boolean
  /** Navigate to a tab's note. */
  activateTab: (path: string) => void
  /** Navigate to the daily view — tab zero. */
  activateDaily: () => void
  /** Close a tab; closing the active one moves to its neighbor, else Daily. */
  closeTab: (path: string) => void
  /** Pin/unpin a tab (pinned tabs collapse to an icon, leading the strip). */
  togglePin: (path: string) => void
  /** Drop a tab that no longer resolves to a note (rename/delete healing). */
  pruneTab: (path: string) => void
  /** Cycle across [Daily, ...tabs]; wraps at the ends. */
  nextTab: () => void
  previousTab: () => void
  /** Close the active tab (`⌘W`); a no-op on Daily and non-note screens. */
  closeActiveTab: () => void
}

/**
 * Safe defaults so surfaces (and their tests) render without the provider:
 * no tabs, every action inert.
 */
const EMPTY: OpenTabsValue = {
  tabs: [],
  activePath: null,
  isDailyActive: false,
  activateTab: () => {},
  activateDaily: () => {},
  closeTab: () => {},
  togglePin: () => {},
  pruneTab: () => {},
  nextTab: () => {},
  previousTab: () => {},
  closeActiveTab: () => {},
}

const OpenTabsContext = createContext<OpenTabsValue>(EMPTY)

/** Strip order: pinned first (stable within each group). */
function stripOrder(tabs: OpenNoteTab[]): OpenNoteTab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
}

/** Whether this note path belongs in the tab set at all. */
function isTabbablePath(path: string): boolean {
  // Daily notes are tab zero; templates are edited, not "open"; an untitled
  // placeholder is mid-birth-rename — its permanent path joins once named.
  return !isDaily(path) && !isTemplatePath(path) && !isUntitledNotePath(path)
}

export function OpenTabsProvider({ children }: { children: ReactNode }): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { graph } = useGraph()
  const { route, navigate } = useRouter()

  const root = graph?.root ?? null
  const stored = settings.openNoteTabs
  const tabs = useMemo(() => stripOrder(root === null ? [] : (stored[root] ?? [])), [stored, root])

  // Every write goes through this: read the graph's own list, mutate, store
  // it back under the graph root — other graphs' sessions stay untouched.
  // Returning the same list means "no change" and writes nothing.
  const updateTabs = useCallback(
    (mutate: (tabs: OpenNoteTab[]) => OpenNoteTab[]) => {
      if (root === null) {
        return
      }
      updateSettingsWith((current) => {
        const graphTabs = current.openNoteTabs[root] ?? []
        const next = mutate(graphTabs)
        // Element-wise check: a filter that dropped nothing or a map that
        // changed nothing is a no-op, and no-op settings writes churn
        // subscribers.
        const unchanged =
          next === graphTabs ||
          (next.length === graphTabs.length && next.every((tab, index) => tab === graphTabs[index]))
        if (unchanged) {
          return {}
        }
        return { openNoteTabs: { ...current.openNoteTabs, [root]: next } }
      })
    },
    [root, updateSettingsWith],
  )

  const routePath = route.kind === 'note' ? route.path : null
  const activePath = routePath !== null && isTabbablePath(routePath) ? routePath : null
  const isDailyActive = route.kind === 'today' || route.kind === 'daily'

  // Every visited note becomes (or stays) a tab, appended after the existing
  // ones. Functional update: two rapid navigations must both land.
  const isOpen = activePath !== null && tabs.some((tab) => tab.path === activePath)
  useEffect(() => {
    // Skip the write entirely when the tab already exists — a no-op settings
    // update still churns subscribers on every render of some providers.
    if (activePath === null || isOpen) {
      return
    }
    updateTabs((graphTabs) =>
      graphTabs.some((tab) => tab.path === activePath)
        ? graphTabs
        : [...graphTabs, { path: activePath, pinned: false }],
    )
  }, [activePath, isOpen, updateTabs])

  const activateTab = useCallback(
    (path: string) => {
      navigate(routeForPath(path))
    },
    [navigate],
  )

  const activateDaily = useCallback(() => {
    navigate({ kind: 'today' })
  }, [navigate])

  const closeTab = useCallback(
    (path: string) => {
      if (path === activePath) {
        // Move off the tab before dropping it: its strip neighbor, else Daily.
        const index = tabs.findIndex((tab) => tab.path === path)
        const neighbor = tabs[index + 1] ?? tabs[index - 1]
        if (neighbor !== undefined) {
          navigate(routeForPath(neighbor.path))
        } else {
          navigate({ kind: 'today' })
        }
      }
      updateTabs((graphTabs) => graphTabs.filter((tab) => tab.path !== path))
    },
    [activePath, tabs, navigate, updateTabs],
  )

  const togglePin = useCallback(
    (path: string) => {
      updateTabs((graphTabs) =>
        graphTabs.map((tab) => (tab.path === path ? { ...tab, pinned: !tab.pinned } : tab)),
      )
    },
    [updateTabs],
  )

  const pruneTab = useCallback(
    (path: string) => {
      updateTabs((graphTabs) => graphTabs.filter((tab) => tab.path !== path))
    },
    [updateTabs],
  )

  // The cycle ring: Daily is index 0. On non-note screens (Tasks, Chat…)
  // nothing is active; Next enters the ring at Daily.
  const cycle = useCallback(
    (step: 1 | -1) => {
      const ring: (string | null)[] = [null, ...tabs.map((tab) => tab.path)]
      // `activePath` is null both on Daily and on non-note screens; only
      // Daily is actually in the ring (as its null entry at index 0), so a
      // bare indexOf(null) would silently treat Tasks/Chat as Daily.
      const current = isDailyActive ? 0 : activePath === null ? -1 : ring.indexOf(activePath)
      if (current === -1) {
        navigate({ kind: 'today' })
        return
      }
      const next = ring[(current + step + ring.length) % ring.length] ?? null
      if (next === null) {
        navigate({ kind: 'today' })
      } else {
        navigate(routeForPath(next))
      }
    },
    [tabs, activePath, isDailyActive, navigate],
  )

  const nextTab = useCallback(() => {
    cycle(1)
  }, [cycle])
  const previousTab = useCallback(() => {
    cycle(-1)
  }, [cycle])

  const closeActiveTab = useCallback(() => {
    if (activePath !== null) {
      closeTab(activePath)
    }
  }, [activePath, closeTab])

  const value = useMemo(
    (): OpenTabsValue => ({
      tabs,
      activePath,
      isDailyActive,
      activateTab,
      activateDaily,
      closeTab,
      togglePin,
      pruneTab,
      nextTab,
      previousTab,
      closeActiveTab,
    }),
    [
      tabs,
      activePath,
      isDailyActive,
      activateTab,
      activateDaily,
      closeTab,
      togglePin,
      pruneTab,
      nextTab,
      previousTab,
      closeActiveTab,
    ],
  )

  return <OpenTabsContext value={value}>{children}</OpenTabsContext>
}

/** The open-tabs model; safe no-op defaults outside the provider. */
export function useOpenTabs(): OpenTabsValue {
  return use(OpenTabsContext)
}
