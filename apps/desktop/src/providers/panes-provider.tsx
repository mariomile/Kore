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
import type { OpenColumn, OpenTab } from '@reflect/core'
import { createValueStore, type ValueStore } from '@/lib/value-store'
import { useGraph } from '@/providers/graph-provider'
import type { NoteFindActions } from '@/providers/note-find-provider'
import { openTabForRoute, routeForOpenTab, tabKey, tabsEqual } from '@/providers/open-tab'
import {
  addTabTo,
  emptyPane,
  findPane,
  flatPanes,
  insertPaneNextTo,
  layoutIdsKey,
  MAIN_PANE_ID,
  removePane,
  removeTabFrom,
  restoredRoute,
  type PaneLocation,
  type PanePlacement,
} from '@/providers/pane-layout'
import { useSettings } from '@/providers/settings-provider'
import type { Route } from '@/routing/route'
import { createRouterStore, type RouterStore } from '@/routing/router-store'

/**
 * The workspace's columns of panes (split panes design, 2026-09-14, part 2).
 * The *layout* is the persisted per-graph `openTabs` entry; the live stores
 * behind each pane (router history, focused daily day) are created here and
 * outlive re-renders, and the active pane is ephemeral. Tab contents are the
 * `OpenTabsProvider`'s business; this provider owns pane entries and moves a
 * whole tab from one pane to another.
 */

export interface WorkspacePaneHandle {
  readonly id: string
  readonly router: RouterStore
  readonly focusedDaily: ValueStore<string | null>
}

/** One column of the workspace: panes stacked top to bottom. */
export interface WorkspaceColumn {
  readonly id: string
  readonly panes: readonly WorkspacePaneHandle[]
}

/** Where a dragged tab lands on a pane: its strip, or a new pane beside it. */
export type DropZone = 'center' | 'right' | 'below'
export type FocusDirection = 'left' | 'right' | 'up' | 'down'

export interface PanesValue {
  readonly columns: readonly WorkspaceColumn[]
  /** Every pane, column-major: column 0 top to bottom, then column 1. */
  readonly panes: readonly WorkspacePaneHandle[]
  readonly activePane: WorkspacePaneHandle
  setActivePane(id: string): void
  /**
   * Open `route` next to `from`: the next column at the same row (`'right'`,
   * the default) or the next pane of `from`'s own column (`'below'`),
   * creating that column or pane when there is none. A route whose tab is
   * already open in some pane (`from` included) navigates and activates
   * *that* pane instead, so nothing is ever mounted twice.
   */
  openInPane(route: Route, options: { from: string; placement?: PanePlacement }): void
  /**
   * Move a whole tab out of `from`. `center` hands it to `to.paneId`'s strip;
   * `right` and `below` create a new pane next to `to.paneId` for it. The
   * target navigates to the tab and becomes active; a source left without
   * tabs closes, one still showing the moved tab falls back to its neighbour.
   */
  moveTab(tab: OpenTab, options: { from: string; to: { paneId: string; zone: DropZone } }): void
  /** Move the active pane's active tab into a new pane beside or under it. */
  moveActiveTab(direction: 'right' | 'down'): void
  /**
   * The id of the pane whose persisted tabs already hold `route`'s tab, or
   * null when no live pane does. A tab key lives in at most one pane, so
   * callers route a link at its holder rather than opening a second editor
   * session on the same path.
   */
  holderOf(route: Route): string | null
  /** Close a pane (and its column when it empties); the last pane never closes. */
  closePane(id: string): void
  focusPane(target: FocusDirection): void
  /** A pane's Find actions, so window-level ⌘F/⌘G reach the active pane. */
  registerFindActions(id: string, actions: NoteFindActions | null): void
  activeFindActions(): NoteFindActions | null
}

const PanesContext = createContext<PanesValue | null>(null)
const PaneIdContext = createContext<string | null>(null)

/** Shared empty list, so "this graph has no layout yet" keeps a stable identity. */
const NO_COLUMNS: readonly OpenColumn[] = []

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

/** Where a live pane sits in the grid, or null when it is not rendered. */
function gridLocation(columns: readonly WorkspaceColumn[], paneId: string): PaneLocation | null {
  const column = columns.findIndex((entry) => entry.panes.some((pane) => pane.id === paneId))
  const row = column === -1 ? -1 : columns[column]!.panes.findIndex((pane) => pane.id === paneId)
  return row === -1 ? null : { column, row }
}

/** A column's pane at `row`, clamped to its last one. */
function paneInColumn(
  column: WorkspaceColumn | undefined,
  row: number,
): WorkspacePaneHandle | undefined {
  return column === undefined ? undefined : column.panes[Math.min(row, column.panes.length - 1)]
}

export function PanesProvider({ initialRoute, children }: PanesProviderProps): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { graph } = useGraph()
  const root = graph?.root ?? null
  const stored = root === null ? NO_COLUMNS : (settings.openTabs[root] ?? NO_COLUMNS)

  // Read inside memos and callbacks instead of depended on: `stored` is
  // rewritten on every tab write in any pane, and depending on it would give
  // `PanesValue` a new identity per navigation.
  const storedRef = useRef(stored)
  storedRef.current = stored

  const handles = useRef(new Map<string, WorkspacePaneHandle>())
  const findActions = useRef(new Map<string, NoteFindActions>())
  // Note-move following is subscribed from an effect, never at construction,
  // so a StrictMode mount→cleanup→re-mount leaves each router connected
  // exactly once: the unsubscribe per pane id lives here.
  const connections = useRef(new Map<string, () => void>())

  const layoutKey = useMemo(() => layoutIdsKey(stored, (id) => handles.current.has(id)), [stored])

  // Handles are created once per id and reused across renders. The first
  // pane launches on today (or the window's own initial route); a *restored*
  // pane reopens its last active tab.
  const columns = useMemo<WorkspaceColumn[]>(
    () =>
      layoutKey.split('|').map((entry, columnIndex) => {
        const separator = entry.indexOf(':')
        return {
          id: entry.slice(0, separator),
          panes: entry
            .slice(separator + 1)
            .split(',')
            .map((id, paneIndex) => {
              const existing = handles.current.get(id)
              if (existing !== undefined) {
                return existing
              }
              const first = columnIndex === 0 && paneIndex === 0
              const persisted = findPane(storedRef.current, id)
              const restored = persisted === null ? null : restoredRoute(persisted)
              const handle = createPaneHandle(id, first ? initialRoute : (restored ?? undefined))
              handles.current.set(id, handle)
              return handle
            }),
        }
      }),
    [layoutKey, initialRoute],
  )

  const panes = useMemo(() => columns.flatMap((column) => column.panes), [columns])

  // `panes` is never empty by construction (the key synthesizes `main`).
  const [activeId, setActiveId] = useState<string>(() => panes[0]!.id)
  const activePane = panes.find((pane) => pane.id === activeId) ?? panes[0]!
  // Correct a ghost active id (its pane never made it into the list: a write
  // skipped for a null graph root, a restored first pane whose id is not
  // `main`) while rendering, so the stored id and the resolved pane cannot
  // drift apart. Every reader already goes through `activePane`.
  if (activeId !== activePane.id) {
    setActiveId(activePane.id)
  }

  // Connect the live panes' routers to note moves, and drop the handles whose
  // pane entry disappeared from settings. The cleanup unsubscribes everything
  // this run connected; the next run reconnects from scratch.
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

  const writeLayout = useCallback(
    (mutate: (columns: OpenColumn[]) => OpenColumn[]) => {
      if (root === null) {
        return
      }
      updateSettingsWith((current) => {
        const graphColumns = current.openTabs[root] ?? []
        // Nothing persisted yet: the live layout is the base, so a split
        // writes the whole document rather than one lone pane.
        const base =
          graphColumns.length === 0
            ? columns.map((column) => ({
                id: column.id,
                panes: column.panes.map((pane) => emptyPane(pane.id)),
              }))
            : graphColumns
        const next = mutate(base)
        return next === base ? {} : { openTabs: { ...current.openTabs, [root]: next } }
      })
    },
    [root, updateSettingsWith, columns],
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
      // two panes at once.
      const openTabsById = new Map(
        flatPanes(storedRef.current).map((entry) => [entry.id, entry.tabs]),
      )
      const holder = panes.find((pane) =>
        (openTabsById.get(pane.id) ?? []).some((open) => tabsEqual(open, tab)),
      )
      return holder?.id ?? null
    },
    [panes],
  )

  // The handle exists before the layout write, so the new pane can be
  // activated and navigated in the same gesture.
  const createPane = useCallback((route: Route | undefined): string => {
    const id = `pane-${crypto.randomUUID()}`
    handles.current.set(id, createPaneHandle(id, route))
    return id
  }, [])

  const openInPane = useCallback(
    (route: Route, { from, placement = 'right' }: { from: string; placement?: PanePlacement }) => {
      const holderId = holderOf(route)
      const holder = holderId === null ? undefined : panes.find((pane) => pane.id === holderId)
      if (holder !== undefined) {
        holder.router.navigate(route)
        setActiveId(holder.id)
        return
      }
      // The pane that already sits where the split would go takes the route.
      const at = gridLocation(columns, from)
      const target =
        at === null
          ? undefined
          : placement === 'below'
            ? columns[at.column]!.panes[at.row + 1]
            : paneInColumn(columns[at.column + 1], at.row)
      if (target !== undefined) {
        target.router.navigate(route)
        setActiveId(target.id)
        return
      }
      const id = createPane(route)
      setActiveId(id)
      writeLayout((current) => insertPaneNextTo(current, from, placement, emptyPane(id)))
    },
    [holderOf, panes, columns, createPane, writeLayout],
  )

  const moveTab = useCallback(
    (tab: OpenTab, { from, to }: { from: string; to: { paneId: string; zone: DropZone } }) => {
      if (to.zone === 'center' && to.paneId === from) {
        return
      }
      // The source's strip as persisted: which tab it falls back to, and
      // whether it empties, are decided before the write rewrites it.
      const source = findPane(storedRef.current, from)
      const sourceTabs = source?.tabs ?? []
      const movedIndex = sourceTabs.findIndex((open) => tabsEqual(open, tab))
      const remaining = sourceTabs.filter((open) => !tabsEqual(open, tab))
      const fallback =
        movedIndex === -1 ? null : (remaining[movedIndex] ?? remaining[movedIndex - 1] ?? null)
      const sourceShowedTab = source !== null && source.activeKey === tabKey(tab)

      const placement: PanePlacement | null = to.zone === 'center' ? null : to.zone
      const created = placement === null ? null : createPane(routeForOpenTab(tab))
      const targetId = created ?? to.paneId
      // A source stripped of its last tab closes: the target is always
      // another pane, so the layout never runs out. A tab that never reached
      // the source's persisted strip closes nothing.
      const emptiesSource = movedIndex !== -1 && remaining.length === 0 && from !== targetId

      writeLayout((current) => {
        const withTarget =
          created === null || placement === null
            ? current
            : insertPaneNextTo(current, to.paneId, placement, emptyPane(created))
        const moved = addTabTo(removeTabFrom(withTarget, from, tab), targetId, tab)
        return emptiesSource ? removePane(moved, from) : moved
      })

      if (created === null) {
        handles.current.get(targetId)?.router.navigate(routeForOpenTab(tab))
      }
      // Never navigate a pane the write removed: its OpenTabsProvider would
      // persist the arrival and resurrect the pane.
      if (!emptiesSource && sourceShowedTab) {
        handles.current
          .get(from)
          ?.router.navigate(fallback === null ? { kind: 'today' } : routeForOpenTab(fallback))
      }
      setActiveId(targetId)
    },
    [createPane, writeLayout],
  )

  const moveActiveTab = useCallback(
    (direction: 'right' | 'down') => {
      const source = findPane(storedRef.current, activePane.id)
      if (source === null || source.activeKey === null) {
        return
      }
      const tab = source.tabs.find((open) => tabKey(open) === source.activeKey)
      if (tab === undefined) {
        return
      }
      moveTab(tab, {
        from: activePane.id,
        to: { paneId: activePane.id, zone: direction === 'right' ? 'right' : 'below' },
      })
    },
    [activePane, moveTab],
  )

  const closePane = useCallback(
    (id: string) => {
      if (panes.length <= 1) {
        return
      }
      const at = gridLocation(columns, id)
      if (at === null) {
        return
      }
      if (id === activePane.id) {
        // The focus falls back down the column, then up it, then to the same
        // row of the column that takes this one's place.
        const column = columns[at.column]!
        const neighbour =
          column.panes[at.row + 1] ??
          column.panes[at.row - 1] ??
          paneInColumn(columns[at.column + 1] ?? columns[at.column - 1], at.row)
        if (neighbour !== undefined) {
          setActiveId(neighbour.id)
        }
      }
      writeLayout((current) => removePane(current, id))
    },
    [panes, columns, activePane, writeLayout],
  )

  const focusPane = useCallback(
    (target: FocusDirection) => {
      const at = gridLocation(columns, activePane.id)
      if (at === null) {
        return
      }
      const next =
        target === 'up' || target === 'down'
          ? columns[at.column]!.panes[target === 'down' ? at.row + 1 : at.row - 1]
          : paneInColumn(columns[target === 'right' ? at.column + 1 : at.column - 1], at.row)
      if (next !== undefined) {
        setActiveId(next.id)
      }
    },
    [columns, activePane],
  )

  const registerFindActions = useCallback((id: string, actions: NoteFindActions | null) => {
    if (actions === null) {
      findActions.current.delete(id)
    } else {
      findActions.current.set(id, actions)
    }
  }, [])

  // The *resolved* active pane, not the raw id: `activeId` can name a pane
  // that never reached the persisted layout (a write skipped for a null graph
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
      columns,
      panes,
      activePane,
      setActivePane,
      openInPane,
      moveTab,
      moveActiveTab,
      holderOf,
      closePane,
      focusPane,
      registerFindActions,
      activeFindActions,
    }),
    [
      columns,
      panes,
      activePane,
      setActivePane,
      openInPane,
      moveTab,
      moveActiveTab,
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

/**
 * Whether the enclosing pane is the one the chrome follows. True wherever no
 * pane model is mounted (mobile, the note window). Routed views read it to
 * decide whether an arrival may take the caret: a pane the user is not in must
 * never pull focus out of the pane they are in.
 */
export function usePaneIsActive(): boolean {
  const panes = use(PanesContext)
  const paneId = usePaneId()
  return panes === null || panes.activePane.id === paneId
}
