# Split panes: several notes side by side

Date: 2026-09-14. Status: approved.

## Goal

The desktop workspace shows N panes side by side, each with its own tab strip,
history, and open note or surface. Obsidian-style: any number of columns,
tabs per column.

## Non-goals

Mobile (separate tree), secondary note windows (stay single-pane), vertical
splits, dragging a tab between panes, persisted pane widths.

## Model

`PanesProvider` (replaces the top-level `RouterProvider` in
`graph-workspace.tsx`) owns an ordered list of panes and the active pane id.
Each pane carries three external stores: router (`createRouterStore`),
focused daily date, note-find session. Providers (`RouterProvider`,
`FocusedDailyProvider`, `NoteFindProvider`) become store bindings
(`useSyncExternalStore`); a provider without a `store` prop creates its own,
so mobile and secondary windows keep working unchanged.

Every pane mounts its providers bound to its own stores. The workspace chrome
(sidebar, palette, context sidebar, deep links, app shortcuts) is mounted
inside providers bound to the **active** pane's stores. `useRouter()` and
friends therefore mean "this pane" inside a pane and "the active pane"
outside one; no consumer changes.

API of `PanesProvider`:

- `openInPane(route, { from })`: open in the pane right of `from`, creating it
  when absent; focus it. If the route's note (or the daily surface) is already
  open in another pane, focus that pane instead.
- `splitRight()`: duplicate the active pane's route into a new pane on its right.
- `closePane(id)`: never closes the last pane.
- `focusPane(id | 'left' | 'right')`.
- `setActive(id)`: called on pointer-down / focus capture inside a pane.

## Tabs

Per pane. Settings `openTabs[root]` changes shape to
`{ panes: [{ id, tabs, activeKey }] }`; no migration of the old array (open
tabs reset once). `OpenTabsProvider` takes `paneId` and reads/writes its
slice; mounted per pane and, for the chrome, bound to the active pane. On
relaunch pane 1 opens on today (unchanged); other panes reopen their last
active tab; a pane with no tabs is dropped. Closing a pane's last tab closes
the pane when another pane exists.

## Layout

`WorkspaceFrame`'s middle column becomes a row of `WorkspacePane`s (tab strip
+ glass card + `RouteContent` + `NoteFindBar`), resize handles between
neighbours (flex widths, not persisted), min width 360px. The active pane's
strip is highlighted.

## Gestures and commands

- ⌘-click on links, backlinks, sidebar rows: open in split (see `openInPane`).
- ⌘⇧-click: new window (previous ⌘-click behaviour). `note.openInNewWindow`
  keeps ⌘⇧O.
- Link intent is a three-way value (`inPlace | split | window`) computed once
  at the UI boundary by a shared helper; `useNoteLinkNavigation` and
  `useBacklinkNavigation` dispatch on it.
- New commands: `pane.splitRight` (⌘⌥\), `pane.close` (no key),
  `pane.focusLeft` / `pane.focusRight` (⌘⌥← / ⌘⌥→).
- Context sidebar, palette, and note-scoped commands follow the active pane.

## Constraints

A note path is open in at most one pane; the daily stream in at most one.
`open-documents.ts` stays single-session-per-path.

## Testing

`router.test.tsx` passes unchanged. New: panes provider (reuse-right, dedupe,
close-last-tab closes pane), per-pane tab schema, one browser test for
active-pane switching via focus. Verify on Chromium and WebKit.
