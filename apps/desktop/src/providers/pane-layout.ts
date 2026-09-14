import type { OpenColumn, OpenPane, OpenTab } from '@reflect/core'
import { routeForOpenTab, tabKey, tabsEqual } from '@/providers/open-tab'
import type { Route } from '@/routing/route'

/**
 * The workspace layout as pure data: ordered columns, each an ordered stack of
 * panes (split panes part 2, 2026-09-14). Every function returns a new list
 * and leaves the input untouched, so `PanesProvider` can compose several of
 * them inside one settings write. Two invariants live here rather than in the
 * provider: a column with no panes is dropped, and a pane's `activeKey`
 * always names one of its own tabs (or is null when it has none).
 */

export const MAIN_PANE_ID = 'main'
export const MAIN_COLUMN_ID = 'main'

/** Where a new pane goes relative to the pane the gesture started from. */
export type PanePlacement = 'right' | 'below'

export interface PaneLocation {
  readonly column: number
  readonly row: number
}

export function emptyPane(id: string): OpenPane {
  return { id, tabs: [], activeKey: null }
}

/** Where a pane sits, or null when the layout does not hold it. */
export function locate(columns: readonly OpenColumn[], paneId: string): PaneLocation | null {
  for (const [column, entry] of columns.entries()) {
    const row = entry.panes.findIndex((pane) => pane.id === paneId)
    if (row !== -1) {
      return { column, row }
    }
  }
  return null
}

/** Insert `pane` at `at`; a row past the column's end appends. */
export function insertPane(
  columns: readonly OpenColumn[],
  pane: OpenPane,
  at: PaneLocation,
): OpenColumn[] {
  return columns.map((column, index) =>
    index === at.column
      ? {
          ...column,
          panes: [...column.panes.slice(0, at.row), pane, ...column.panes.slice(at.row)],
        }
      : column,
  )
}

/** Insert `column` at `at`; an index past the end appends. */
export function insertColumn(
  columns: readonly OpenColumn[],
  column: OpenColumn,
  at: number,
): OpenColumn[] {
  return [...columns.slice(0, at), column, ...columns.slice(at)]
}

/** Remove a pane, and its column when that was its last one. */
export function removePane(columns: readonly OpenColumn[], paneId: string): OpenColumn[] {
  return columns
    .map((column) => ({ ...column, panes: column.panes.filter((pane) => pane.id !== paneId) }))
    .filter((column) => column.panes.length > 0)
}

/** Every pane of the layout, column-major. */
export function flatPanes(columns: readonly OpenColumn[]): OpenPane[] {
  return columns.flatMap((column) => column.panes)
}

/** A pane's persisted entry, or null when the layout does not hold it. */
export function findPane(columns: readonly OpenColumn[], paneId: string): OpenPane | null {
  return flatPanes(columns).find((pane) => pane.id === paneId) ?? null
}

function mapPane(
  columns: readonly OpenColumn[],
  paneId: string,
  change: (pane: OpenPane) => OpenPane,
): OpenColumn[] {
  return columns.map((column) => ({
    ...column,
    panes: column.panes.map((pane) => (pane.id === paneId ? change(pane) : pane)),
  }))
}

/**
 * Drop `tab` from a pane's strip. When it was the pane's active tab, the
 * neighbour that slides into its place takes over (the next tab, else the
 * previous one, else nothing).
 */
export function removeTabFrom(
  columns: readonly OpenColumn[],
  paneId: string,
  tab: OpenTab,
): OpenColumn[] {
  return mapPane(columns, paneId, (pane) => {
    const index = pane.tabs.findIndex((open) => tabsEqual(open, tab))
    if (index === -1) {
      return pane
    }
    const tabs = pane.tabs.filter((open) => !tabsEqual(open, tab))
    if (pane.activeKey !== tabKey(tab)) {
      return { ...pane, tabs }
    }
    const neighbour = tabs[index] ?? tabs[index - 1] ?? null
    return { ...pane, tabs, activeKey: neighbour === null ? null : tabKey(neighbour) }
  })
}

/** Append `tab` to a pane's strip (unless already there) and show it. */
export function addTabTo(
  columns: readonly OpenColumn[],
  paneId: string,
  tab: OpenTab,
): OpenColumn[] {
  return mapPane(columns, paneId, (pane) => ({
    ...pane,
    tabs: pane.tabs.some((open) => tabsEqual(open, tab)) ? pane.tabs : [...pane.tabs, tab],
    activeKey: tabKey(tab),
  }))
}

export function newColumnId(): string {
  return `column-${crypto.randomUUID()}`
}

/** The route a persisted pane reopens on: its last active tab, else nothing. */
export function restoredRoute(pane: OpenPane): Route | null {
  if (pane.activeKey === null) {
    return null
  }
  const active = pane.tabs.find((tab) => tabKey(tab) === pane.activeKey)
  return active === undefined ? null : routeForOpenTab(active)
}

/**
 * The stored layout after the restore filter, as one string: that is
 * everything the provider's handle list depends on, and it survives the tab
 * writes that rewrite the layout on every navigation. The first pane of the
 * first column always stays (it launches the window); another pane is kept
 * when a handle is already live for it (a split opened just now is empty
 * until its tab strip fills it) or when it has a tab to reopen.
 * Shape: `columnId:paneId,paneId|columnId:paneId`. Ids are `main` or uuids,
 * so none of `:`, `,`, `|` can occur inside one.
 */
export function layoutIdsKey(
  stored: readonly OpenColumn[],
  isLive: (paneId: string) => boolean,
): string {
  const columns = stored
    .map((column, columnIndex) => ({
      id: column.id,
      paneIds: column.panes
        .filter(
          (pane, paneIndex) =>
            (columnIndex === 0 && paneIndex === 0) ||
            isLive(pane.id) ||
            restoredRoute(pane) !== null,
        )
        .map((pane) => pane.id),
    }))
    .filter((column) => column.paneIds.length > 0)
  if (columns.length === 0) {
    return `${MAIN_COLUMN_ID}:${MAIN_PANE_ID}`
  }
  return columns.map((column) => `${column.id}:${column.paneIds.join(',')}`).join('|')
}

/**
 * Place `pane` next to `relativeTo`: under it in its own column, or alone in
 * a new column right after its one. A `relativeTo` the layout does not hold
 * (a snapshot that diverged from the persisted document) appends a column
 * rather than guessing a position.
 */
export function insertPaneNextTo(
  columns: readonly OpenColumn[],
  relativeTo: string,
  placement: PanePlacement,
  pane: OpenPane,
): OpenColumn[] {
  const at = locate(columns, relativeTo)
  if (at === null) {
    return insertColumn(columns, { id: newColumnId(), panes: [pane] }, columns.length)
  }
  if (placement === 'below') {
    return insertPane(columns, pane, { column: at.column, row: at.row + 1 })
  }
  return insertColumn(columns, { id: newColumnId(), panes: [pane] }, at.column + 1)
}
