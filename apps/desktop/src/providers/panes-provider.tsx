import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { OpenPane } from '@reflect/core'
import { createValueStore, type ValueStore } from '@/lib/value-store'
import { useGraph } from '@/providers/graph-provider'
import type { NoteFindActions } from '@/providers/note-find-provider'
import { openTabForRoute, routeForOpenTab, tabKey, tabsEqual } from '@/providers/open-tab'
import { useSettings } from '@/providers/settings-provider'
import type { Route } from '@/routing/route'
import { createRouterStore, type RouterStore } from '@/routing/router-store'

/**
 * The workspace's side-by-side panes (split panes design, 2026-09-14). The
 * pane *list* is the persisted per-graph `openTabs` entry (one `OpenPane`
 * per column, in order); the live stores behind each pane (router history,
 * focused daily day) are created here and outlive re-renders, and the active
 * pane is ephemeral. Tab contents are the `OpenTabsProvider`'s business; this
 * provider only creates and removes pane entries.
 */

export interface WorkspacePaneHandle {
  readonly id: string
  readonly router: RouterStore
  readonly focusedDaily: ValueStore<string | null>
}

export interface PanesValue {
  readonly panes: readonly WorkspacePaneHandle[]
  readonly activePane: WorkspacePaneHandle
  setActivePane(id: string): void
  /**
   * Open `route` beside `from`: in the pane to its right, creating one at the
   * end when `from` is the last. A route whose tab is already open in some
   * pane (any column, `from` included) navigates and activates *that* pane
   * instead, so a note or singleton surface is never mounted twice.
   */
  openInPane(route: Route, options: { from: string }): void
  /**
   * The id of the pane whose persisted tabs already hold `route`'s tab, or
   * null when no live pane does. The spec's one rule about tab identity: a
   * tab key lives in at most one pane, so callers route a link at its holder
   * rather than opening a second editor session on the same path.
   */
  holderOf(route: Route): string | null
  /** Close a pane; the last pane never closes. */
  closePane(id: string): void
  focusPane(target: 'left' | 'right'): void
  /** A pane's Find actions, so window-level ⌘F/⌘G reach the active pane. */
  registerFindActions(id: string, actions: NoteFindActions | null): void
  activeFindActions(): NoteFindActions | null
}

const PanesContext = createContext<PanesValue | null>(null)
const PaneIdContext = createContext<string | null>(null)

export const MAIN_PANE_ID = 'main'

/** Shared empty list, so "this graph has no panes yet" keeps a stable identity. */
const NO_PANES: readonly OpenPane[] = []

interface PanesProviderProps {
  /** The first pane's launch route; defaults to today. */
  initialRoute?: Route | undefined
  children: ReactNode
}

function createPaneHandle(id: string, route: Route | undefined): WorkspacePaneHandle {
  return {
    id,
    router: createRouterStore(route),
    focusedDaily: createValueStore<string | null>(null),
  }
}

/** The route a persisted pane reopens on: its last active tab, else nothing. */
function restoredRoute(pane: OpenPane): Route | null {
  if (pane.activeKey === null) {
    return null
  }
  const active = pane.tabs.find((tab) => tabKey(tab) === pane.activeKey)
  return active === undefined ? null : routeForOpenTab(active)
}

function emptyPane(id: string): OpenPane {
  return { id, tabs: [], activeKey: null }
}

export function PanesProvider({ initialRoute, children }: PanesProviderProps): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { graph } = useGraph()
  const root = graph?.root ?? null
  const stored = root === null ? NO_PANES : (settings.openTabs[root] ?? NO_PANES)

  // Read inside memos and callbacks instead of depended on: `stored` is
  // rewritten on every tab write in any pane, and depending on it would give
  // `PanesValue` (and the note-move subscription keyed off it) a new identity
  // per navigation.
  const storedRef = useRef(stored)
  storedRef.current = stored

  const handles = useRef(new Map<string, WorkspacePaneHandle>())
  const findActions = useRef(new Map<string, NoteFindActions>())
  // Note-move following is subscribed from an effect, never at construction,
  // so a StrictMode mount→cleanup→re-mount leaves each router connected
  // exactly once. The unsubscribe per pane id lives here.
  const connections = useRef(new Map<string, () => void>())

  // Pane 1 always launches on today (or the window's own initial route); a
  // *restored* extra pane reopens its last active tab and is dropped when it
  // has none. A pane this session already owns a handle for is kept whatever
  // its persisted tabs say: a pane opened just now is empty until the tab
  // strip fills it, and dropping it would undo the split mid-gesture.
  // Handles are created once per id and reused across renders.
  // The ordered ids first, as one string: that is everything the handle list
  // depends on, and it survives the tab writes that rewrite `stored` on every
  // navigation. A pane id is `main` or a uuid, so a newline cannot occur in
  // one.
  const paneIdsKey = useMemo(() => {
    const restored = stored.filter(
      (pane, position) =>
        position === 0 || handles.current.has(pane.id) || restoredRoute(pane) !== null,
    )
    const ids = restored.length === 0 ? [MAIN_PANE_ID] : restored.map((pane) => pane.id)
    return ids.join('\n')
  }, [stored])

  const panes = useMemo<WorkspacePaneHandle[]>(
    () =>
      paneIdsKey.split('\n').map((id, position) => {
        const existing = handles.current.get(id)
        if (existing !== undefined) {
          return existing
        }
        const entry = storedRef.current.find((pane) => pane.id === id)
        const restored = entry === undefined ? null : restoredRoute(entry)
        const route = position === 0 ? initialRoute : (restored ?? undefined)
        const handle = createPaneHandle(id, route)
        handles.current.set(id, handle)
        return handle
      }),
    [paneIdsKey, initialRoute],
  )

  // `panes` is never empty by construction (the memo synthesizes `main`).
  const [activeId, setActiveId] = useState<string>(() => panes[0]!.id)
  const activePane = panes.find((pane) => pane.id === activeId) ?? panes[0]!
  // Correct a ghost active id (its pane never made it into the list: a write
  // skipped for a null graph root, a restored first pane whose id is not
  // `main`) while rendering, so the stored id and the resolved pane cannot
  // drift apart. Every reader already goes through `activePane`; this only
  // keeps the state itself honest.
  if (activeId !== activePane.id) {
    setActiveId(activePane.id)
  }

  // Connect the live panes' routers to note moves, and drop the handles whose
  // pane entry disappeared from settings. The cleanup unsubscribes everything
  // this run connected: the next run reconnects from scratch.
  useEffect(() => {
    const live = new Set(panes.map((pane) => pane.id))
    for (const pane of panes) {
      if (!connections.current.has(pane.id)) {
        connections.current.set(pane.id, pane.router.connect())
      }
    }
    for (const id of handles.current.keys()) {
      if (live.has(id)) {
        continue
      }
      connections.current.get(id)?.()
      connections.current.delete(id)
      handles.current.delete(id)
      findActions.current.delete(id)
    }
    return () => {
      for (const disconnect of connections.current.values()) {
        disconnect()
      }
      connections.current.clear()
    }
  }, [panes])

  const writePanes = useCallback(
    (mutate: (panes: OpenPane[]) => OpenPane[]) => {
      if (root === null) {
        return
      }
      updateSettingsWith((current) => {
        const graphPanes = current.openTabs[root] ?? []
        const next = mutate(graphPanes)
        return next === graphPanes ? {} : { openTabs: { ...current.openTabs, [root]: next } }
      })
    },
    [root, updateSettingsWith],
  )

  const setActivePane = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const holderOf = useCallback(
    (route: Route): string | null => {
      const tab = openTabForRoute(route)
      if (tab === null) {
        return null
      }
      // Only rendered panes can hold a tab: a persisted pane the restore
      // filter dropped must not win the lookup, or the key would end up in
      // two persisted panes at once.
      const openTabsById = new Map(storedRef.current.map((pane) => [pane.id, pane.tabs]))
      const holder = panes.find((pane) =>
        (openTabsById.get(pane.id) ?? []).some((open) => tabsEqual(open, tab)),
      )
      return holder?.id ?? null
    },
    [panes],
  )

  const openInPane = useCallback(
    (route: Route, { from }: { from: string }) => {
      const holderId = holderOf(route)
      const holder = holderId === null ? undefined : panes.find((pane) => pane.id === holderId)
      if (holder !== undefined) {
        holder.router.navigate(route)
        setActiveId(holder.id)
        return
      }
      const fromIndex = panes.findIndex((pane) => pane.id === from)
      const right = panes[fromIndex + 1]
      if (right !== undefined) {
        right.router.navigate(route)
        setActiveId(right.id)
        return
      }
      const id = `pane-${crypto.randomUUID()}`
      handles.current.set(id, createPaneHandle(id, route))
      setActiveId(id)
      writePanes((graphPanes) => {
        const base = graphPanes.length === 0 ? panes.map((pane) => emptyPane(pane.id)) : graphPanes
        // `from` can be missing when the persisted list diverged from the
        // `stored` snapshot (queued updaters draining against the loaded
        // document): append rather than silently inserting at the front.
        const fromIndex = base.findIndex((pane) => pane.id === from)
        const insertAt = fromIndex === -1 ? base.length : fromIndex + 1
        return [...base.slice(0, insertAt), emptyPane(id), ...base.slice(insertAt)]
      })
    },
    [holderOf, panes, writePanes],
  )

  const closePane = useCallback(
    (id: string) => {
      if (panes.length <= 1) {
        return
      }
      const index = panes.findIndex((pane) => pane.id === id)
      if (index === -1) {
        return
      }
      if (id === activePane.id) {
        const neighbor = panes[index + 1] ?? panes[index - 1]
        if (neighbor !== undefined) {
          setActiveId(neighbor.id)
        }
      }
      writePanes((graphPanes) => graphPanes.filter((pane) => pane.id !== id))
    },
    [panes, activePane, writePanes],
  )

  const focusPane = useCallback(
    (target: 'left' | 'right') => {
      const index = panes.findIndex((pane) => pane.id === activePane.id)
      const next = panes[target === 'left' ? index - 1 : index + 1]
      if (next !== undefined) {
        setActiveId(next.id)
      }
    },
    [panes, activePane],
  )

  const registerFindActions = useCallback((id: string, actions: NoteFindActions | null) => {
    if (actions === null) {
      findActions.current.delete(id)
    } else {
      findActions.current.set(id, actions)
    }
  }, [])

  // The *resolved* active pane, not the raw id: `activeId` can name a pane
  // that never reached the persisted list (a write skipped for a null graph
  // root, a restored first pane whose id is not `main`).
  const activeIdRef = useRef(activePane.id)
  useEffect(() => {
    activeIdRef.current = activePane.id
  })
  const activeFindActions = useCallback(
    () => findActions.current.get(activeIdRef.current) ?? null,
    [],
  )

  const value = useMemo<PanesValue>(
    () => ({
      panes,
      activePane,
      setActivePane,
      openInPane,
      holderOf,
      closePane,
      focusPane,
      registerFindActions,
      activeFindActions,
    }),
    [
      panes,
      activePane,
      setActivePane,
      openInPane,
      holderOf,
      closePane,
      focusPane,
      registerFindActions,
      activeFindActions,
    ],
  )

  return <PanesContext value={value}>{children}</PanesContext>
}

/** The pane model. Use within a PanesProvider. */
export function usePanes(): PanesValue {
  const context = use(PanesContext)
  if (!context) {
    throw new Error('usePanes must be used within a PanesProvider')
  }
  return context
}

/** The pane model when one is mounted, else null (mobile, the note window). */
export function useOptionalPanes(): PanesValue | null {
  return use(PanesContext)
}

/** The id of the enclosing pane, or null outside any `PaneScope`. */
export function useScopedPaneId(): string | null {
  return use(PaneIdContext)
}

/** Mark a subtree as rendering inside one pane. */
export function PaneScope({ id, children }: { id: string; children: ReactNode }): ReactElement {
  return <PaneIdContext value={id}>{children}</PaneIdContext>
}

/** The id of the enclosing pane, or the active pane's id outside any pane. */
export function usePaneId(): string {
  const scoped = useScopedPaneId()
  const panes = use(PanesContext)
  return scoped ?? panes?.activePane.id ?? MAIN_PANE_ID
}
