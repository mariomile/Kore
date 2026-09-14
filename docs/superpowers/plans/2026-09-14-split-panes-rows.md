# Split Panes Part 2 (columns of rows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panes can stack vertically inside columns; a tab moves to a new pane below or to the right by drag or keyboard; the rail toggles render once per window.

**Architecture:** The persisted layout becomes `OpenColumn[]` (each a stack of `OpenPane`). `PanesProvider` derives `columns` and the flat `panes` list from it and gains `moveTab` / `moveActiveTab` / 4-way `focusPane`. `WorkspaceFrame` renders columns of panes with two-axis resize handles. One `DndContext` at the frame; strips keep `SortableContext` and handle same-strip reorder through `useDndMonitor`; each pane shows three droppable zones while a tab drags; a pure resolver maps drag-end to a move.

**Tech Stack:** React 19, zod (`@reflect/core` settings), `@dnd-kit/core` 6.3 (`useDroppable`, `useDndMonitor`, `pointerWithin`), Vitest browser (Chromium + WebKit).

**Spec:** `docs/superpowers/specs/2026-09-14-split-panes-rows-design.md` (extends `2026-09-14-split-panes-design.md`).

## Global Constraints

- Work from `/Users/mariomiletta/.t3/worktrees/Kore/t3code-656cca35`, branch `t3code/side-by-side-notes` (PR #209, not merged). Never bare `git stash`.
- Test commands: browser `cd apps/desktop && pnpm exec vitest run --config ../../vitest.config.ts --project browser <paths>` (WebKit: prefix `REFLECT_TEST_BROWSER=webkit`); node `... --project node <paths>`; core `pnpm --filter @reflect/core test --run <path>`. Typecheck: `pnpm typecheck` at the root (only gate); lint: `pnpm lint`. `console.warn`/`console.error` fail tests.
- No `any`, no type assertions, named exports, one component per file, `@/` imports, function declarations for named functions, icons from `@/components/icons` only, no em-dashes in any text you write, no migrations or compatibility shims.
- Keybinding spelling in `app-commands.ts`: `Alt-Mod-<key>` and `Alt-Mod-Shift-<key>` with lowercase key names (`arrowup`, `arrowdown`, `arrowleft`, `arrowright`), matching `pane.focusLeft` = `Alt-Mod-arrowleft`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Existing invariants stay: a tab key lives in at most one pane (`holderOf`); the last pane never closes; `RouterStore.connect()` from an effect; the chrome's `OpenTabsProvider` mirror never writes.

---

### Task 1: Columns in the settings schema

**Files:**
- Modify: `packages/core/src/settings/schema.ts` (near `OpenPane` ~141, `openPaneSchema` ~240, `openTabsSchema` ~251)
- Modify: `packages/core/src/settings/schema.test.ts` (the `openTabs` cases)
- Modify: the `OpenPane` export site in `packages/core/src/exports/platform.ts` (add `OpenColumn`)

**Interfaces:**
- Produces: `export interface OpenColumn { readonly id: string; readonly panes: OpenPane[] }`; `settings.openTabs: Record<string, OpenColumn[]>`.

- [ ] **Step 1: Update the tests.** Change every `openTabs` fixture and expectation to the column shape, e.g. `{ '/graph': [{ id: 'main', panes: [{ id: 'main', tabs: [...], activeKey: 'note:notes/a.md' }] }] }`. Change the "drops a pre-pane flat tab list" case so the input is the part-1 flat `OpenPane[]` and the expectation is `{ '/graph': [] }`.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @reflect/core test --run src/settings/schema.test.ts`.
- [ ] **Step 3: Schema.** After `OpenPane` add `OpenColumn`. Add `const openColumnSchema: z.ZodType<OpenColumn> = z.object({ id: z.string().min(1), panes: z.array(openPaneSchema).catch([]) })` and make `openTabsSchema = z.record(z.string(), z.array(openColumnSchema).catch([])).refine((value) => !Array.isArray(value)).catch({})`. Update the doc comment (columns of panes; a malformed column drops the graph's layout). Export `OpenColumn` next to `OpenPane`.
- [ ] **Step 4: Run tests + core typecheck** (`cd packages/core && pnpm exec tsc -b tsconfig.json --force`). Desktop typecheck goes red in `panes-provider.tsx` / `open-tabs-provider.tsx` until Tasks 2 and 3.
- [ ] **Step 5: Commit** `feat: persist workspace panes as columns of rows`.

---

### Task 2: Columns model in PanesProvider

**Files:**
- Modify: `apps/desktop/src/providers/panes-provider.tsx`
- Modify: `apps/desktop/src/providers/panes-provider.test.tsx`

**Interfaces:**
- Consumes: `OpenColumn`, `OpenPane` from `@reflect/core`; `tabKey`, `tabsEqual`, `routeForOpenTab`, `openTabForRoute` from `@/providers/open-tab`.
- Produces on `PanesValue`:

```ts
export interface WorkspaceColumn { readonly id: string; readonly panes: readonly WorkspacePaneHandle[] }
export type PanePlacement = 'right' | 'below'
export type DropZone = 'center' | 'right' | 'below'
export type FocusDirection = 'left' | 'right' | 'up' | 'down'
columns: readonly WorkspaceColumn[]
panes: readonly WorkspacePaneHandle[]            // flat, column-major (unchanged consumers)
openInPane(route: Route, options: { from: string; placement?: PanePlacement }): void
moveTab(tab: OpenTab, options: { from: string; to: { paneId: string; zone: DropZone } }): void
moveActiveTab(direction: 'right' | 'down'): void
closePane(id: string): void
focusPane(target: FocusDirection): void
```
plus `MAIN_COLUMN_ID = 'main'`.

- [ ] **Step 1: Tests first.** Extend `panes-provider.test.tsx` (keep the existing cases; adapt their settings seeding to columns). The mocked `updateSettingsWith` must apply patches to a `{ openTabs: Record<string, OpenColumn[]> }` document. Add:

```tsx
it('opens below: a second pane in the same column', async () => {
  const { result, act } = await renderHook(usePanes, { wrapper })
  const first = result.current.activePane.id
  await act(() => result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first, placement: 'below' }))
  expect(result.current.columns).toHaveLength(1)
  expect(result.current.columns[0]!.panes.map((pane) => pane.id)).toEqual([first, result.current.activePane.id])
})

it('opens right: a new column after the source column', async () => {
  const { result, act } = await renderHook(usePanes, { wrapper })
  const first = result.current.activePane.id
  await act(() => result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }))
  expect(result.current.columns).toHaveLength(2)
  expect(result.current.columns[1]!.panes).toHaveLength(1)
})

it('moves a tab into a new pane below and closes an emptied source pane', async () => {
  const { result, act } = await renderHook(usePanes, { wrapper })
  const first = result.current.activePane.id
  await act(() => result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }))
  const second = result.current.activePane.id
  // Seed what OpenTabsProvider would have written for the second pane.
  await act(() => seedPaneTabs(second, [{ kind: 'note', path: 'notes/a.md', pinned: false }], 'note:notes/a.md'))
  await act(() => result.current.moveTab({ kind: 'note', path: 'notes/a.md', pinned: false }, { from: second, to: { paneId: first, zone: 'below' } }))
  expect(result.current.columns).toHaveLength(1)
  expect(result.current.columns[0]!.panes).toHaveLength(2)
  expect(result.current.activePane.router.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/a.md' })
  expect(result.current.panes.some((pane) => pane.id === second)).toBe(false)
})

it('moves a tab into an existing pane (center) and the source keeps its other tab', async () => {
  // seed pane `main` with two note tabs, open a second pane, move one tab center into it;
  // assert the tab left `main`'s persisted tabs and joined the target's, and the target's route is that note.
})

it('focuses up and down inside a column, left and right across columns keeping the row', async () => {
  // build a 2x2 layout via openInPane right + below on both columns, then walk with focusPane and assert activePane.id.
})

it('removes a column when its last pane closes', async () => {
  // open right, close the new pane, expect columns length 1.
})
```

`seedPaneTabs(paneId, tabs, activeKey)` is a test helper that calls the mocked `updateSettingsWith` to set that pane's tabs inside whatever column holds it.

- [ ] **Step 2: Run to see the new cases fail.**

- [ ] **Step 3: Implement.** Rewrite the model around columns. Guidance, keeping the existing structure (handles map, connections effect, `storedRef`, render-phase `activeId` correction, `holderOf`):

```ts
/** Column-major flat view of the stored layout, after the restore filter. */
function layoutIdsKey(stored: readonly OpenColumn[], handles: Map<string, WorkspacePaneHandle>): string {
  const columns = stored
    .map((column, columnIndex) => ({
      id: column.id,
      paneIds: column.panes
        .filter((pane, paneIndex) => (columnIndex === 0 && paneIndex === 0) || handles.has(pane.id) || restoredRoute(pane) !== null)
        .map((pane) => pane.id),
    }))
    .filter((column) => column.paneIds.length > 0)
  if (columns.length === 0) {
    return `${MAIN_COLUMN_ID}:${MAIN_PANE_ID}`
  }
  // "columnId:paneId,paneId|columnId:paneId" ; ids are `main` or uuids, so ':' ',' '|' cannot occur in one.
  return columns.map((column) => `${column.id}:${column.paneIds.join(',')}`).join('|')
}
```

`columns` memo parses that key, creating handles as today (the first pane of the first column takes `initialRoute`). `panes = columns.flatMap((column) => column.panes)`.

`writeLayout(mutate: (columns: OpenColumn[]) => OpenColumn[])` replaces `writePanes`; when the stored list is empty, the base is the synthesized layout (`[{ id: MAIN_COLUMN_ID, panes: [emptyPane(MAIN_PANE_ID)] }]`) with the current handles' ids.

Helpers on `OpenColumn[]` (pure, in the same file or `providers/pane-layout.ts` if the file passes 500 lines):

```ts
function locate(columns: readonly OpenColumn[], paneId: string): { column: number; row: number } | null
function insertPane(columns: OpenColumn[], pane: OpenPane, at: { column: number; row: number }): OpenColumn[]        // row may equal panes.length (append)
function insertColumn(columns: OpenColumn[], column: OpenColumn, at: number): OpenColumn[]
function removePane(columns: OpenColumn[], paneId: string): OpenColumn[]                                          // drops an emptied column
function removeTabFrom(columns: OpenColumn[], paneId: string, tab: OpenTab): OpenColumn[]
function addTabTo(columns: OpenColumn[], paneId: string, tab: OpenTab): OpenColumn[]                              // sets activeKey = tabKey(tab)
```

`openInPane`: holder dedupe as today. Then `placement === 'below'`: target = the pane after `from` in its column, else create a new pane after `from` in that column. `placement === 'right'` (default): the next column's pane at the same row index clamped to its last, else create a new column after `from`'s with one new pane. Creation: make the handle first (`handles.current.set`), `setActiveId`, then `writeLayout` inserting `emptyPane(id)` (or a new column `{ id: \`column-${crypto.randomUUID()}\`, panes: [emptyPane(id)] }`). When `from` cannot be located (diverged snapshot), append a new column at the end.

`moveTab(tab, { from, to })`: if `to.zone === 'center'` and `to.paneId === from`, return. Compute the target pane id: `center` → `to.paneId`; `right`/`below` → a freshly created pane placed relative to `to.paneId` exactly like `openInPane` creates one (reuse a shared `createPaneAt(relativeTo, placement)` that returns the new id and the layout mutation). Then in ONE `writeLayout`: `removeTabFrom(from, tab)` then `addTabTo(targetId, tab)`; if the source pane's tab list becomes empty and the layout still has another pane, `removePane(from)`; else if the source pane's `activeKey === tabKey(tab)`, set its `activeKey` to a neighbour tab's key (next, else previous). After the write: navigate the target handle's router to `routeForOpenTab(tab)`; if the source survived and its active tab was the moved one, navigate the source handle's router to the neighbour tab's route (else `{ kind: 'today' }` when it was the only tab and the last pane); `setActiveId(targetId)`. Read the source's tabs from `storedRef.current` before the write.

`moveActiveTab(direction)`: source = `activePane.id`; its stored `activeKey` resolves to a tab in its persisted tabs (return when none); call `moveTab(tab, { from: source, to: { paneId: source, zone: direction === 'right' ? 'right' : 'below' } })`.

`closePane(id)`: `panes.length <= 1` guard; neighbour for the active id = next pane in the same column, else previous in the column, else the pane at the same row in the next column, else previous column; `writeLayout(removePane)`.

`focusPane(target)`: locate the active pane; `up`/`down` = row ± 1 within the column; `left`/`right` = column ± 1, row clamped to that column's last pane.

- [ ] **Step 4: Run** `panes-provider.test.tsx` on Chromium and WebKit; `pnpm typecheck` may still be red in `open-tabs-provider.tsx` (Task 3).
- [ ] **Step 5: Commit** `feat: stack workspace panes inside columns`.

---

### Task 3: OpenTabsProvider writes across columns

**Files:**
- Modify: `apps/desktop/src/providers/open-tabs-provider.tsx` (`pane` lookup ~line 121, `updateTabs` ~131-165, `closeTab`)
- Modify: tests that seed `openTabs` (`note-tabs-strip.test.tsx`, `workspace-content.test.tsx`, `workspace-pane.test.tsx`, any other `grep -rl "openTabs" apps/desktop/src --include='*.test.tsx'`)

- [ ] **Step 1:** `pane` lookup: `stored[root]?.flatMap((column) => column.panes).find((entry) => entry.id === paneId)`. In `updateTabs`, locate the pane across columns and replace it in place; when missing, append it to the first column (create `{ id: MAIN_COLUMN_ID, panes: [updated] }` when there are no columns). Import `MAIN_COLUMN_ID` from `panes-provider`.
- [ ] **Step 2:** Update the test fixtures to columns (wrap existing pane arrays as one column each, ids `main`).
- [ ] **Step 3:** Run the touched tests on Chromium; `pnpm typecheck` must be green now.
- [ ] **Step 4: Commit** `feat: record open tabs inside the pane's column`.

---

### Task 4: Frame layout, two-axis resize, rail toggles once

**Files:**
- Modify: `apps/desktop/src/components/workspace-content.tsx` (`WorkspaceFrame` panes map ~154-159)
- Modify: `apps/desktop/src/components/pane-resize-handle.tsx`
- Modify: `apps/desktop/src/components/workspace-pane.tsx`
- Modify: `apps/desktop/src/components/note-tabs-strip.tsx` (the two `PanelToggle`s and `useSidebar`)
- Tests: `workspace-pane.test.tsx` (toggle placement), `workspace-content.test.tsx` if it asserts frame geometry

- [ ] **Step 1: Frame.**

```tsx
{columns.map((column, columnIndex) => (
  <Fragment key={column.id}>
    {columnIndex > 0 ? <PaneResizeHandle axis="columns" /> : null}
    <div data-testid="workspace-column" className="flex min-w-[360px] flex-1 flex-col">
      {column.panes.map((pane, rowIndex) => (
        <Fragment key={pane.id}>
          {rowIndex > 0 ? <PaneResizeHandle axis="rows" /> : null}
          <WorkspacePane
            pane={pane}
            commandContext={commandContext}
            showSidebarToggle={columnIndex === 0 && rowIndex === 0}
            showContextToggle={columnIndex === columns.length - 1 && rowIndex === 0}
          />
        </Fragment>
      ))}
    </div>
  </Fragment>
))}
```

`WorkspacePane`'s root loses `min-w-[360px]` and becomes `flex min-h-0 min-w-0 flex-1 flex-col`; it forwards the two booleans to `WorkspaceTabsStrip`.

- [ ] **Step 2: Handle.** `PaneResizeHandle({ axis })`: for `columns` behave as today (width, min 360, `cursor-col-resize`, `w-2`, `aria-orientation="vertical"`); for `rows` resize the previous sibling's height from `clientY` (min 200, `cursor-row-resize`, `h-2`, `aria-orientation="horizontal"`, edge line `after:inset-x-0 after:h-0.5`). Same teardown for pointerup/pointercancel/lostpointercapture. Keep the existing cancel test and add its `rows` twin.
- [ ] **Step 3: Strip.** `WorkspaceTabsStrip` gains `showSidebarToggle?: boolean` and `showContextToggle?: boolean` (default `true` so the existing strip tests and any other caller keep their toggles). Render the left `PanelToggle` only when `showSidebarToggle`, the right one only when `showContextToggle`; keep `NavigateArrows` in every strip. When the left toggle is hidden the leading group still renders the arrows; when the right one is hidden drop the trailing group entirely.
- [ ] **Step 4: Test.** In `workspace-pane.test.tsx` add one case: with two columns rendered by the harness, the first pane has "Toggle sidebar" and no "Toggle context panel"; the second pane has "Toggle context panel" and no "Toggle sidebar". Run pane + content + strip tests on Chromium and WebKit; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat: stack panes in columns with one set of rail toggles`.

---

### Task 5: Drag a tab into another pane

**Files:**
- Create: `apps/desktop/src/lib/tab-drop.ts`, `apps/desktop/src/lib/tab-drop.test.ts`
- Create: `apps/desktop/src/components/pane-drop-zones.tsx`
- Modify: `apps/desktop/src/components/workspace-content.tsx` (frame-level `DndContext`)
- Modify: `apps/desktop/src/components/note-tabs-strip.tsx` (remove its `DndContext`; sortable data; `useDndMonitor` for same-strip reorder)
- Modify: `apps/desktop/src/components/workspace-pane.tsx` (mount `PaneDropZones` over the card)
- Modify: strip/pane tests to wrap in a `DndContext` where the strip is rendered without the frame

**Interfaces:**

```ts
// lib/tab-drop.ts
export interface TabDragData { readonly kind: 'tab'; readonly paneId: string; readonly tab: OpenTab }
export interface ZoneDropData { readonly kind: 'zone'; readonly paneId: string; readonly zone: DropZone }
export type TabDrop =
  | { readonly kind: 'reorder'; readonly paneId: string; readonly tab: OpenTab; readonly target: OpenTab }
  | { readonly kind: 'move'; readonly tab: OpenTab; readonly from: string; readonly to: { paneId: string; zone: DropZone } }
export function zoneDropId(paneId: string, zone: DropZone): string   // `zone:${paneId}:${zone}`
export function resolveTabDrop(active: { data: unknown }, over: { data: unknown } | null): TabDrop | null
```

`resolveTabDrop` validates both `data` payloads with zod (`kind: 'tab'` / `kind: 'zone'`), returns `reorder` when over is a tab in the same pane, `move` with zone `center` when over is a tab in another pane, `move` with the zone when over is a zone (ignoring `center` on the tab's own pane), and `null` otherwise.

- [ ] **Step 1: Resolver test first** (`tab-drop.test.ts`, node): same-pane tab → reorder; other-pane tab → move center; zone right → move right; zone center on own pane → null; malformed data → null.
- [ ] **Step 2: Implement `tab-drop.ts`.**
- [ ] **Step 3: Frame `DndContext`.** In `WorkspaceFrame`: `const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))`; `collisionDetection` = pointer-within first, restricted so a `right`/`below` zone beats `center` and any zone beats a tab pill, falling back to `closestCenter` for pills:

```ts
function tabDropCollision(args: Parameters<CollisionDetection>[0]): ReturnType<CollisionDetection> {
  const within = pointerWithin(args)
  const zones = within.filter((hit) => String(hit.id).startsWith('zone:'))
  const edge = zones.filter((hit) => !String(hit.id).endsWith(':center'))
  if (edge.length > 0) return edge
  if (zones.length > 0) return zones
  return closestCenter(args)
}
```

`onDragEnd`: `const drop = resolveTabDrop(event.active, event.over); if (drop?.kind === 'move') panes.moveTab(drop.tab, { from: drop.from, to: drop.to })`. Reorders are the strip's business (next step). Wrap the whole columns row in `<DndContext sensors collisionDetection onDragEnd onDragStart onDragCancel>`; keep `dragging: boolean` state (set on start, cleared on end/cancel) and provide it through a tiny `PaneDragContext` (in `pane-drop-zones.tsx`) so panes know when to show zones.
- [ ] **Step 4: Strip.** Remove the strip's `DndContext` and sensors; keep `SortableContext`; `useSortable({ id: tabKey(tab), data: { kind: 'tab', paneId, tab } })` (paneId from `usePaneId()`); replace `handleDragEnd` with `useDndMonitor({ onDragEnd(event) { const drop = resolveTabDrop(event.active, event.over); if (drop?.kind === 'reorder' && drop.paneId === paneId) moveTab(drop.tab, drop.target) } })` (that `moveTab` is `useOpenTabs().moveTab`, the reorder). The strip must still render when no `DndContext` is above it (the note window does not render it, but tests do): wrap test harnesses in `<DndContext>`.
- [ ] **Step 5: Drop zones.** `pane-drop-zones.tsx`: `PaneDropZones({ paneId })` renders nothing unless dragging; otherwise an absolutely positioned overlay inside the pane card with three `useDroppable` regions (`zoneDropId(paneId, zone)`, `data: { kind: 'zone', paneId, zone }`): `center` covering the card, `right` the right 25%, `below` the bottom 40%; each tints (`bg-accent/10`, `ring-1 ring-accent`) when `isOver`. `pointer-events` stay on so `pointerWithin` sees them. Mount it in `WorkspacePane` inside the relative card wrapper.
- [ ] **Step 6: Tests.** Run `tab-drop.test.ts` (node), strip + pane + content tests (Chromium and WebKit); add one browser case in `workspace-pane.test.tsx`: with `PaneDragContext` forced to dragging, the pane renders three zones with the expected ids.
- [ ] **Step 7: Commit** `feat: drag a tab into another pane or a new split`.

---

### Task 6: Keyboard commands

**Files:**
- Modify: `apps/desktop/src/lib/commands/types.ts`, `apps/desktop/src/lib/commands/app-commands.ts`, `apps/desktop/src/routing/app-shortcuts.ts`
- Modify: `apps/desktop/src/routing/app-shortcuts.test.tsx` (+ the `CommandContext` stubs in other tests, `grep -rn "focusPane:" apps/desktop/src --include='*.test.tsx'`)

- [ ] **Step 1:** `CommandContext.focusPane(target: 'left' | 'right' | 'up' | 'down')`; add `moveActiveTab(direction: 'right' | 'down'): void`. Commands: `pane.focusUp` (`Alt-Mod-arrowup`), `pane.focusDown` (`Alt-Mod-arrowdown`), `pane.moveTabRight` (`Alt-Mod-Shift-arrowright`, title "Move tab to a new pane on the right"), `pane.moveTabDown` (`Alt-Mod-Shift-arrowdown`, title "Move tab to a new pane below"). Wire through the existing `panesRef` in `useAppShortcuts`.
- [ ] **Step 2:** Add one shortcut test: `Alt+Meta+Shift+ArrowDown` calls `moveActiveTab('down')`.
- [ ] **Step 3:** Run shortcuts tests + `app-commands.test.ts`; `pnpm typecheck`; commit `feat: keyboard commands to move tabs and focus panes vertically`.

---

### Task 7: Verification and docs

- [ ] `pnpm check` exit 0.
- [ ] Browser on Chromium: `src/routing src/providers src/components/workspace-pane.test.tsx src/components/workspace-content.test.tsx src/components/note-tabs-strip.test.tsx src/components/pane-resize-handle.test.tsx src/hooks src/lib`; WebKit: `src/providers src/components/workspace-pane.test.tsx src/components/note-tabs-strip.test.tsx`. Node: `src/lib src/routing src/providers`. Core: `src/settings`.
- [ ] Dev harness smoke: ⌘-click opens right; ⌥⌘⇧↓ moves the tab below (two rows); drag a pill onto the lower zone of the other column; ⌥⌘↑/↓ walk; ⌘W closes the emptied pane and the column disappears; toggles appear once. Screenshot for the PR.
- [ ] Update `docs/STATE.md` (split panes section + session log) and the PR #209 body (layout section, commands, verification numbers). Commit `docs:`.
