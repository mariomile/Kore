import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { OpenTab } from '@reflect/core'
import { useGraph } from '@/providers/graph-provider'
import { openTabForRoute, routeForOpenTab, tabKey, tabsEqual } from '@/providers/open-tab'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'

/**
 * The open-tabs model behind both tab surfaces (the strip over the note pane
 * and the sidebar's Open section — design options A + B). One ordered list of
 * open tabs per graph, persisted in settings (`openNoteTabs`, keyed by graph
 * root — the settings document is global, and unkeyed tabs would leak into
 * other graphs and be pruned away there) so a relaunch restores the session.
 * Daily notes are never tabs: the Daily view is the fixed "tab zero" every
 * surface renders itself, always first and never closable — so `tabs` here
 * holds ordinary notes and workspace screens (Settings, Browser).
 */

export interface OpenTabsValue {
  /** Open tabs in strip order (pinned first). */
  tabs: OpenTab[]
  /** The tab the current route addresses, or null (daily view, search, …). */
  activeTab: OpenTab | null
  /** The note path the current route addresses, or null. */
  activePath: string | null
  /** True while the route is the daily view — the fixed tab zero. */
  isDailyActive: boolean
  /** Navigate to a tab's note or screen. */
  activateTab: (tab: OpenTab) => void
  /** Navigate to the daily view — tab zero. */
  activateDaily: () => void
  /** Close a tab; closing the active one moves to its neighbor, else Daily. */
  closeTab: (tab: OpenTab) => void
  /** Pin/unpin a tab (pinned tabs collapse to an icon, leading the strip). */
  togglePin: (tab: OpenTab) => void
  /** Drop a note tab that no longer resolves (rename/delete healing). */
  pruneTab: (path: string) => void
  /** Cycle across [Daily, ...tabs]; wraps at the ends. */
  nextTab: () => void
  previousTab: () => void
  /** Close the active tab (`⌘W`); a no-op on Daily and non-tab screens. */
  closeActiveTab: () => void
}

/**
 * Safe defaults so surfaces (and their tests) render without the provider:
 * no tabs, every action inert.
 */
const EMPTY: OpenTabsValue = {
  tabs: [],
  activeTab: null,
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
function stripOrder(tabs: OpenTab[]): OpenTab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
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
    (mutate: (tabs: OpenTab[]) => OpenTab[]) => {
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

  const routeTab = openTabForRoute(route)
  const routeTabKey = routeTab === null ? null : tabKey(routeTab)
  const activeTab =
    routeTab === null ? null : (tabs.find((tab) => tabKey(tab) === routeTabKey) ?? routeTab)
  const activePath = activeTab?.kind === 'note' ? activeTab.path : null
  const isDailyActive = route.kind === 'today' || route.kind === 'daily'

  // Every visited tabbable route becomes (or stays) a tab, appended after
  // the existing ones. Functional update: two rapid navigations must both land.
  const isOpen = routeTabKey !== null && tabs.some((tab) => tabKey(tab) === routeTabKey)
  useEffect(() => {
    // Skip the write entirely when the tab already exists — a no-op settings
    // update still churns subscribers on every render of some providers.
    if (routeTabKey === null || isOpen) {
      return
    }
    const incoming = openTabForRoute(route)
    if (incoming === null) {
      return
    }
    updateTabs((graphTabs) =>
      graphTabs.some((tab) => tabKey(tab) === routeTabKey) ? graphTabs : [...graphTabs, incoming],
    )
  }, [route, routeTabKey, isOpen, updateTabs])

  const activateTab = useCallback(
    (tab: OpenTab) => {
      navigate(routeForOpenTab(tab))
    },
    [navigate],
  )

  const activateDaily = useCallback(() => {
    navigate({ kind: 'today' })
  }, [navigate])

  const closeTab = useCallback(
    (tab: OpenTab) => {
      if (activeTab !== null && tabsEqual(tab, activeTab)) {
        // Move off the tab before dropping it: its strip neighbor, else Daily.
        const index = tabs.findIndex((open) => tabsEqual(open, tab))
        const neighbor = tabs[index + 1] ?? tabs[index - 1]
        if (neighbor !== undefined) {
          navigate(routeForOpenTab(neighbor))
        } else {
          navigate({ kind: 'today' })
        }
      }
      updateTabs((graphTabs) => graphTabs.filter((open) => !tabsEqual(open, tab)))
    },
    [activeTab, tabs, navigate, updateTabs],
  )

  const togglePin = useCallback(
    (tab: OpenTab) => {
      updateTabs((graphTabs) =>
        graphTabs.map((open) => (tabsEqual(open, tab) ? { ...open, pinned: !open.pinned } : open)),
      )
    },
    [updateTabs],
  )

  const pruneTab = useCallback(
    (path: string) => {
      updateTabs((graphTabs) =>
        graphTabs.filter((tab) => !(tab.kind === 'note' && tab.path === path)),
      )
    },
    [updateTabs],
  )

  // The cycle ring: Daily is index 0. On non-tab screens (Tasks, Chat, …)
  // nothing is active; Next enters the ring at Daily.
  const cycle = useCallback(
    (step: 1 | -1) => {
      const ring: (OpenTab | null)[] = [null, ...tabs]
      const current = isDailyActive
        ? 0
        : activeTab === null
          ? -1
          : ring.findIndex((entry) => entry !== null && tabsEqual(entry, activeTab))
      if (current === -1) {
        navigate({ kind: 'today' })
        return
      }
      const next = ring[(current + step + ring.length) % ring.length] ?? null
      if (next === null) {
        navigate({ kind: 'today' })
      } else {
        navigate(routeForOpenTab(next))
      }
    },
    [tabs, activeTab, isDailyActive, navigate],
  )

  const nextTab = useCallback(() => {
    cycle(1)
  }, [cycle])
  const previousTab = useCallback(() => {
    cycle(-1)
  }, [cycle])

  const closeActiveTab = useCallback(() => {
    if (activeTab !== null) {
      closeTab(activeTab)
    }
  }, [activeTab, closeTab])

  const value = useMemo(
    (): OpenTabsValue => ({
      tabs,
      activeTab,
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
      activeTab,
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
