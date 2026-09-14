# Split panes, part 2: columns of rows, tab moves, one set of rail toggles

Date: 2026-09-14. Status: approved. Extends
[2026-09-14-split-panes-design.md](2026-09-14-split-panes-design.md); lands on
the same branch as PR #209 so the persisted shape changes once before merge.

## Goal

A pane can sit below another pane, not only beside it. The user moves a tab
into a new pane below or to the right by dragging its pill or with a keyboard
command. The sidebar and context-panel toggles appear once in the window, not
once per pane.

## Non-goals

Arbitrary split trees (a row that itself contains columns). Persisted pane
sizes. Moving a tab into another window.

## Model

The workspace is an ordered list of **columns**; each column is an ordered
stack of **panes**. A pane is unchanged from part 1 (own router, tabs,
focused daily day, Find). Persisted per graph:

```
openTabs[root]: OpenColumn[]
OpenColumn = { id: string; panes: OpenPane[] }
OpenPane   = { id: string; tabs: OpenTab[]; activeKey: string | null }   (unchanged)
```

No migration: the part-1 flat `OpenPane[]` shape never shipped.

Rules, unchanged: a tab key lives in at most one pane; the last pane never
closes. New: a column with no panes is removed; the first pane of the first
column launches on today (or the window's initial route); other restored
panes reopen their last active tab and are dropped when they have none.

`PanesProvider` API (additions and changes):

- `columns: readonly { id; panes: readonly WorkspacePaneHandle[] }[]`;
  `panes` stays as the flat, column-major list.
- `openInPane(route, { from, placement?: 'right' | 'below' })`, default
  `'right'`. Right: the pane in the next column at the same row (clamped),
  creating a new column after `from`'s when none; below: the next pane in
  `from`'s column, creating one after `from` when none. Holder dedupe first,
  as before.
- `moveTab(tab, { from, to: { paneId, zone: 'center' | 'right' | 'below' } })`.
  Center: the tab joins `paneId`'s strip. Right / below: a new pane is
  created beside or under `paneId` and receives the tab. The target pane
  navigates to the tab's route and becomes active. The source pane, if it
  still has tabs and was showing the moved one, navigates to its neighbour
  tab; if it has no tabs left it closes (and its column, when empty).
- `moveActiveTab(direction: 'right' | 'down')`: `moveTab` of the active
  pane's active tab with `to = { paneId: active, zone }`.
- `closePane(id)`: removes the pane from its column, and the column when it
  empties; never the last pane.
- `focusPane('left' | 'right' | 'up' | 'down')`: left/right move one column
  keeping the row index (clamped); up/down move within the column.

## Layout

`WorkspaceFrame` renders columns as a flex row; each column is a flex column
of `WorkspacePane`s. `PaneResizeHandle` gains `axis: 'columns' | 'rows'`
(resizes the previous sibling's width or height; min 360px wide, 200px
tall). Sizes are not persisted.

The tab strip holds only tabs, the "+" and list menus, and this pane's
back/forward arrows (history is per pane). The sidebar toggle renders only in
the top pane of the first column; the context-panel toggle only in the top
pane of the last column.

## Drag and drop

One `DndContext` at the frame wraps every strip. Strips keep their
`SortableContext` for same-strip reorder, handled through `useDndMonitor`
inside the strip (events whose active and over both belong to that pane).
While a tab drags, every pane shows three droppable zones over its card:
`center` (whole card), `right` (right quarter), `below` (bottom 40%); the
smaller zones win when the pointer is inside them. Dropping on a zone calls
`moveTab`; dropping on a tab pill of another pane counts as `center`.
The pure resolver `resolveTabDrop(active, over)` in `lib/tab-drop.ts` maps a
drag-end event to a move instruction or a reorder, and is unit-tested.

## Commands

`pane.moveTabRight` (⌥⌘⇧→), `pane.moveTabDown` (⌥⌘⇧↓), `pane.focusUp`
(⌥⌘↑), `pane.focusDown` (⌥⌘↓); `pane.focusLeft/Right` unchanged.

## Testing

Node: schema (columns), `resolveTabDrop`. Browser: panes provider (open
below, move center/right/below, source closes when empty, column removed
when empty, focus up/down), strip toggles present only on the outer panes,
existing pane and strip tests. Chromium and WebKit.
