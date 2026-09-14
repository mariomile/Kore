import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { OpenPane, OpenTab } from '@reflect/core'
import { onChatConversationDeleted } from '@/lib/chat-events'
import { onNoteMoved } from '@/lib/note-moves'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useGraph } from '@/providers/graph-provider'
import { useOptionalPanes } from '@/providers/panes-provider'
import {
  openTabForRoute,
  routeForOpenTab,
  tabKey,
  tabsEqual,
  tabStateEqual,
  updateOpenTabRoute,
} from '@/providers/open-tab'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'

/**
 * The open-tabs model behind both tab surfaces (the strip over the note pane
 * and the sidebar's Open section — design options A + B). One ordered list of
 * open tabs per graph, persisted in settings (`openTabs`, keyed by graph
 * root — the settings document is global, and unkeyed tabs would leak into
 * other graphs) so a relaunch restores the session. Notes and conversations
 * have distinct identities; workspace pages are singleton tabs whose latest
 * route payload is retained. Settings is a full-page workspace and is not a
 * tab.
 */

export interface OpenTabsValue {
  /** Open tabs in strip order (pinned first). */
  tabs: OpenTab[]
  /** The tab the current route addresses, or null for excluded note routes. */
  activeTab: OpenTab | null
  /** The note path the current route addresses, or null. */
  activePath: string | null
  /** Navigate to a tab's note or screen. */
  activateTab: (tab: OpenTab) => void
  /** Close a tab; closing the active one moves to its neighbor, else Daily. */
  closeTab: (tab: OpenTab) => void
  /** Pin/unpin a tab (pinned tabs collapse to an icon, leading the strip). */
  togglePin: (tab: OpenTab) => void
  /**
   * Drop `tab` at `target`'s strip position (drag reorder). Works in strip
   * coordinates; since the strip regroups pinned-first on read, a drop
   * across the pin boundary clamps to the tab's own group edge.
   */
  moveTab: (tab: OpenTab, target: OpenTab) => void
  /** Drop a note tab that no longer resolves (rename/delete healing). */
  pruneTab: (path: string) => void
  /** Cycle across open tabs; wraps at the ends. */
  nextTab: () => void
  previousTab: () => void
  /** Close the active tab (`⌘W`). */
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
  activateTab: () => {},
  closeTab: () => {},
  togglePin: () => {},
  moveTab: () => {},
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

function createDailyTab(): OpenTab {
  return { kind: 'surface', surface: 'daily', date: null, pinned: false }
}

export function OpenTabsProvider({
  paneId,
  children,
}: {
  paneId: string
  children: ReactNode
}): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { graph } = useGraph()
  const { route, navigate } = useRouter()
  const chatSession = useOptionalChatSession()
  const panes = useOptionalPanes()
  const activeConversationId = chatSession?.activeConversationId ?? null
  const openConversation = chatSession?.openConversation

  const root = graph?.root ?? null
  const stored = settings.openTabs
  const pane = useMemo(
    () => (root === null ? undefined : stored[root]?.find((entry) => entry.id === paneId)),
    [stored, root, paneId],
  )
  const tabs = useMemo(() => stripOrder(pane?.tabs ?? []), [pane])

  // Every write goes through this: read this pane's own list, mutate, store
  // it back under the graph root — other panes and other graphs' sessions
  // stay untouched. Returning the same list means "no change" and writes
  // nothing. `activeKey` is passed only by the route effect, which is the one
  // place that knows which tab the pane is showing; every other write keeps
  // the stored key.
  const updateTabs = useCallback(
    (mutate: (tabs: OpenTab[]) => OpenTab[], activeKey?: string) => {
      if (root === null) {
        return
      }
      updateSettingsWith((current) => {
        const graphPanes = current.openTabs[root] ?? []
        const existing = graphPanes.find((entry) => entry.id === paneId)
        const paneTabs = existing?.tabs ?? []
        const next = mutate(paneTabs)
        const nextActiveKey = activeKey ?? existing?.activeKey ?? null
        // Element-wise check: a filter that dropped nothing or a map that
        // changed nothing is a no-op, and no-op settings writes churn
        // subscribers.
        const tabsUnchanged =
          next === paneTabs ||
          (next.length === paneTabs.length && next.every((tab, index) => tab === paneTabs[index]))
        if (existing !== undefined && tabsUnchanged && nextActiveKey === existing.activeKey) {
          return {}
        }
        const updated: OpenPane = { id: paneId, tabs: next, activeKey: nextActiveKey }
        // A pane opened by the split gesture is persisted empty: its first
        // visited route is what creates the entry here when it is missing.
        const nextPanes =
          existing === undefined
            ? [...graphPanes, updated]
            : graphPanes.map((entry) => (entry.id === paneId ? updated : entry))
        return { openTabs: { ...current.openTabs, [root]: nextPanes } }
      })
    },
    [root, paneId, updateSettingsWith],
  )

  const routeTab = openTabForRoute(route, activeConversationId)
  const routeTabKey = routeTab === null ? null : tabKey(routeTab)
  const activeTab =
    routeTab === null ? null : (tabs.find((tab) => tabKey(tab) === routeTabKey) ?? routeTab)
  const activePath = activeTab?.kind === 'note' ? activeTab.path : null

  // Every visited route becomes or updates one tab. Functional updates keep
  // rapid navigations and mutable singleton payloads (date/tag/query) intact.
  useEffect(() => {
    const incoming = openTabForRoute(route, activeConversationId)
    if (incoming === null) {
      return
    }
    updateTabs((paneTabs) => {
      const existing = paneTabs.find((tab) => tabsEqual(tab, incoming))
      if (existing === undefined) {
        return [...paneTabs, incoming]
      }
      const updated = updateOpenTabRoute(existing, incoming)
      return tabStateEqual(existing, updated)
        ? paneTabs
        : paneTabs.map((tab) => (tabsEqual(tab, incoming) ? updated : tab))
    }, tabKey(incoming))
  }, [route, activeConversationId, updateTabs])

  const activateTab = useCallback(
    (tab: OpenTab) => {
      if (
        tab.kind === 'chat' &&
        tab.conversationId !== activeConversationId &&
        openConversation !== undefined
      ) {
        void openConversation(tab.conversationId).then(() => {
          navigate(routeForOpenTab(tab))
        })
        return
      }
      navigate(routeForOpenTab(tab))
    },
    [activeConversationId, navigate, openConversation],
  )

  const closeTab = useCallback(
    (tab: OpenTab) => {
      // Closing a split pane's last tab closes the column; the single-pane
      // workspace keeps its Daily fallback instead of emptying the window.
      const remainingCount = tabs.filter((open) => !tabsEqual(open, tab)).length
      if (remainingCount === 0 && panes !== null && panes.panes.length > 1) {
        panes.closePane(paneId)
        return
      }
      if (activeTab !== null && tabsEqual(tab, activeTab)) {
        // Move off the tab before dropping it: its strip neighbor, else Daily.
        const index = tabs.findIndex((open) => tabsEqual(open, tab))
        const neighbor = tabs[index + 1] ?? tabs[index - 1]
        if (neighbor !== undefined) {
          activateTab(neighbor)
        } else {
          navigate({ kind: 'today' })
        }
      }
      updateTabs((paneTabs) => {
        const remaining = paneTabs.filter((open) => !tabsEqual(open, tab))
        return remaining.length === 0 ? [createDailyTab()] : remaining
      })
    },
    [panes, paneId, activeTab, tabs, activateTab, navigate, updateTabs],
  )

  const togglePin = useCallback(
    (tab: OpenTab) => {
      updateTabs((paneTabs) =>
        paneTabs.map((open) => (tabsEqual(open, tab) ? { ...open, pinned: !open.pinned } : open)),
      )
    },
    [updateTabs],
  )

  const moveTab = useCallback(
    (tab: OpenTab, target: OpenTab) => {
      updateTabs((paneTabs) => {
        // Work in strip coordinates — that is the order the user dragged in.
        // The moved array becomes the stored order; `stripOrder` on read
        // regroups pinned-first, so both groups keep their dragged order and
        // a cross-group drop settles at the tab's own group boundary.
        const ordered = stripOrder(paneTabs)
        const from = ordered.findIndex((open) => tabsEqual(open, tab))
        const to = ordered.findIndex((open) => tabsEqual(open, target))
        if (from === -1 || to === -1 || from === to) {
          return paneTabs
        }
        const next = [...ordered]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
        return next
      })
    },
    [updateTabs],
  )

  const pruneTab = useCallback(
    (path: string) => {
      updateTabs((paneTabs) =>
        paneTabs.filter((tab) => !(tab.kind === 'note' && tab.path === path)),
      )
    },
    [updateTabs],
  )

  useEffect(
    () =>
      onNoteMoved((from, to) => {
        updateTabs((paneTabs) => {
          const moved = paneTabs.find((tab) => tab.kind === 'note' && tab.path === from)
          if (moved === undefined) {
            return paneTabs
          }
          const target = paneTabs.find((tab) => tab.kind === 'note' && tab.path === to)
          if (target !== undefined) {
            return paneTabs
              .filter((tab) => tab !== moved)
              .map((tab) =>
                tab === target && moved.pinned && !target.pinned
                  ? { ...target, pinned: true }
                  : tab,
              )
          }
          return paneTabs.map((tab) => (tab === moved ? { ...moved, path: to } : tab))
        })
      }),
    [updateTabs],
  )

  useEffect(
    () =>
      onChatConversationDeleted((conversationId) => {
        const deleted = tabs.find(
          (tab) => tab.kind === 'chat' && tab.conversationId === conversationId,
        )
        if (deleted !== undefined) {
          closeTab(deleted)
        }
      }),
    [tabs, closeTab],
  )

  const cycle = useCallback(
    (step: 1 | -1) => {
      if (tabs.length === 0) {
        navigate({ kind: 'today' })
        return
      }
      const current =
        activeTab === null ? -1 : tabs.findIndex((entry) => tabsEqual(entry, activeTab))
      const nextIndex =
        current === -1
          ? step === 1
            ? 0
            : tabs.length - 1
          : (current + step + tabs.length) % tabs.length
      activateTab(tabs[nextIndex]!)
    },
    [tabs, activeTab, activateTab, navigate],
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
      activateTab,
      closeTab,
      togglePin,
      moveTab,
      pruneTab,
      nextTab,
      previousTab,
      closeActiveTab,
    }),
    [
      tabs,
      activeTab,
      activePath,
      activateTab,
      closeTab,
      togglePin,
      moveTab,
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
