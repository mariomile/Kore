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
import { onChatConversationDeleted } from '@/lib/chat-events'
import { onNoteMoved } from '@/lib/note-moves'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useGraph } from '@/providers/graph-provider'
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
 * route payload is retained.
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
  const chatSession = useOptionalChatSession()
  const activeConversationId = chatSession?.activeConversationId ?? null
  const openConversation = chatSession?.openConversation

  const root = graph?.root ?? null
  const stored = settings.openTabs
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
        const graphTabs = current.openTabs[root] ?? []
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
        return { openTabs: { ...current.openTabs, [root]: next } }
      })
    },
    [root, updateSettingsWith],
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
    updateTabs((graphTabs) => {
      const existing = graphTabs.find((tab) => tabsEqual(tab, incoming))
      if (existing === undefined) {
        return [...graphTabs, incoming]
      }
      const updated = updateOpenTabRoute(existing, incoming)
      return tabStateEqual(existing, updated)
        ? graphTabs
        : graphTabs.map((tab) => (tabsEqual(tab, incoming) ? updated : tab))
    })
  }, [route, activeConversationId, updateTabs])

  const activateTab = useCallback(
    (tab: OpenTab) => {
      if (
        tab.kind === 'chat' &&
        tab.conversationId !== activeConversationId &&
        openConversation !== undefined
      ) {
        void openConversation(tab.conversationId)
      }
      navigate(routeForOpenTab(tab))
    },
    [activeConversationId, navigate, openConversation],
  )

  const closeTab = useCallback(
    (tab: OpenTab) => {
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
      updateTabs((graphTabs) => graphTabs.filter((open) => !tabsEqual(open, tab)))
    },
    [activeTab, tabs, activateTab, navigate, updateTabs],
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

  useEffect(
    () =>
      onNoteMoved((from, to) => {
        updateTabs((graphTabs) => {
          const moved = graphTabs.find((tab) => tab.kind === 'note' && tab.path === from)
          if (moved === undefined) {
            return graphTabs
          }
          const target = graphTabs.find((tab) => tab.kind === 'note' && tab.path === to)
          if (target !== undefined) {
            return graphTabs
              .filter((tab) => tab !== moved)
              .map((tab) =>
                tab === target && moved.pinned && !target.pinned ? { ...target, pinned: true } : tab,
              )
          }
          return graphTabs.map((tab) =>
            tab === moved ? { ...moved, path: to } : tab,
          )
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
      const nextIndex = current === -1 ? 0 : (current + step + tabs.length) % tabs.length
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
