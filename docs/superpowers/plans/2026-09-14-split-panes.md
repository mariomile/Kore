# Split Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop workspace shows N note panes side by side, each with its own tab strip and history; ⌘-click on a note link opens it in the pane to the right.

**Architecture:** The router's history state moves out of React into a plain external store (`createRouterStore`) so one `RouterProvider` can be mounted per pane and again, bound to the *active* pane's store, around the workspace chrome. A new `PanesProvider` owns the pane list (persisted per graph in settings as per-pane tab lists) and the active pane. `WorkspaceFrame` renders a row of `WorkspacePane`s.

**Tech Stack:** React 19 (`use`, `useSyncExternalStore`), zod settings schema in `@reflect/core`, Vitest browser project (Chromium + WebKit), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-14-split-panes-design.md`

## Global Constraints

- Run every command from the repo root `/Users/mariomiletta/.t3/worktrees/Kore/t3code-656cca35`. Do not `cd` into the main checkout.
- `.test.tsx` runs in the browser project: `pnpm --filter @reflect/desktop exec vitest run --project browser <path>`; `.test.ts` runs in node: `pnpm --filter @reflect/desktop exec vitest run --project node <path>`. Core tests: `pnpm --filter @reflect/core test --run <path>`.
- `console.warn` / `console.error` fail tests.
- No `any`, no type assertions, named exports, kebab-case files, `@/` imports, function declarations for named functions.
- Icons only from `@/components/icons`. UI primitives from `apps/desktop/src/components/ui/`.
- Do not touch `apps/desktop/package.json` version, the changelog, or `.github/release-please/`.
- Mobile tree (`apps/desktop/src/mobile`) and the secondary note window (`NoteWindowContent`) must keep working with `RouterProvider` used without a `store` prop.
- Commit after each task with a conventional-commit message. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No em-dashes anywhere.

## Deviations from the spec (decided while planning, apply as written)

1. **No ⌘⇧-click for "new window".** Meowdown's wiki-link click payload carries only `mod: boolean`, no shift. The modifier click now means *split* everywhere; "Open in new window" remains via ⌘⇧O and the note context menu. The boolean option is renamed `openInNewWindow` → `openInSplit` across the app.
2. **No `pane.splitRight` command.** It would duplicate the active tab into a second pane, which the one-pane-per-tab rule forbids. Panes are created only by opening a note in split. `pane.close`, `pane.focusLeft`, `pane.focusRight` stay.
3. **Persisted shape** is `openTabs[root]: OpenPane[]` (`{ id, tabs, activeKey }`), not `{ panes: [...] }`.
4. **Note-find stays a React-state provider mounted per pane.** The chrome's ⌘F / ⌘G reach the active pane through an actions registry on `PanesProvider` instead of a shared store.
5. **Deep links (`reflect://`) ignore the split modifier** and navigate in place. Their resolution runs through the graph-scoped handler bound to the active pane; routing it to a neighbour pane is out of scope.

---

## File map

| File | Responsibility |
|---|---|
| `apps/desktop/src/routing/router-store.ts` (new) | History stack, scroll offsets, navigation revision as a plain store. |
| `apps/desktop/src/routing/router.tsx` (rewrite) | Thin binding of a `RouterStore` to `RouterContext`; same public API. |
| `apps/desktop/src/lib/value-store.ts` (new) | 15-line generic external store for one value. |
| `apps/desktop/src/providers/focused-daily-provider.tsx` (modify) | Accept an optional `store` prop. |
| `packages/core/src/settings/schema.ts` (modify) | `OpenPane` type + `openTabs` becomes per-pane. |
| `apps/desktop/src/providers/panes-provider.tsx` (new) | Pane list, active pane, open-in-split, close, focus, find registry. |
| `apps/desktop/src/providers/open-tabs-provider.tsx` (modify) | Takes `paneId`; reads/writes that pane's slice; closing the last tab closes the pane. |
| `apps/desktop/src/hooks/use-note-link-navigation.ts` (modify) | `openInSplit` dispatches to `openInPane`. |
| `apps/desktop/src/components/workspace-pane.tsx` (new) | One pane: providers bound to its stores, strip, card, route content, find bar. |
| `apps/desktop/src/components/workspace-content.tsx` (modify) | Middle column becomes the pane row. |
| `apps/desktop/src/components/graph-workspace.tsx` (modify) | `PanesProvider` replaces the top `RouterProvider` for the main window. |
| `apps/desktop/src/lib/commands/app-commands.ts`, `types.ts`, `routing/app-shortcuts.ts` (modify) | Pane commands. |

---

### Task 1: Router store

**Files:**
- Create: `apps/desktop/src/routing/router-store.ts`
- Rewrite: `apps/desktop/src/routing/router.tsx`
- Test (existing, must pass unchanged): `apps/desktop/src/routing/router.test.tsx`
- Test (new): `apps/desktop/src/routing/router-store.test.ts`

**Interfaces:**
- Produces: `createRouterStore(initialRoute?: Route): RouterStore`, `RouterStore` (`subscribe`, `getSnapshot`, `navigate`, `back`, `forward`, `navigationRevision`, `saveScrollState`, `clearScrollState`, `savedScroll`, `dispose`), `RouterSnapshot`. `RouterProvider` gains an optional `store?: RouterStore` prop. `NavigateOptions` is re-exported from `router.tsx` so existing imports keep working.

- [ ] **Step 1: Write the failing store test**

`apps/desktop/src/routing/router-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRouterStore } from './router-store'

describe('createRouterStore', () => {
  it('navigates, truncates forward history, and notifies subscribers', () => {
    const store = createRouterStore()
    let notified = 0
    store.subscribe(() => {
      notified += 1
    })
    store.navigate({ kind: 'daily', date: '2026-06-08' })
    store.navigate({ kind: 'note', path: 'notes/a.md' })
    store.back()
    expect(store.getSnapshot().route).toEqual({ kind: 'daily', date: '2026-06-08' })
    expect(store.getSnapshot().canForward).toBe(true)
    store.navigate({ kind: 'search', query: 'x' })
    expect(store.getSnapshot().canForward).toBe(false)
    expect(notified).toBe(4)
  })

  it('returns the same snapshot object until something changes', () => {
    const store = createRouterStore()
    const before = store.getSnapshot()
    store.back() // at the bottom of the stack: a true no-op
    expect(store.getSnapshot()).toBe(before)
    expect(store.navigationRevision()).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @reflect/desktop exec vitest run --project node src/routing/router-store.test.ts`
Expected: FAIL, module `./router-store` not found.

- [ ] **Step 3: Write the store**

`apps/desktop/src/routing/router-store.ts`:

```ts
import { isMobileSurface } from '@/lib/platform-surface'
import { onNoteMoved } from '@/lib/note-moves'
import { normalizeRoute, routesEqual, type Route } from './route'

/**
 * The router's state as a plain external store (Plan 06 history semantics,
 * lifted out of React so one store can back several `RouterProvider`
 * bindings: a pane's own subtree and the workspace chrome bound to the
 * active pane). Behaviour is unchanged from the previous provider: `navigate`
 * pushes and truncates forward entries, `back`/`forward` move the cursor,
 * history entries carry scroll offsets, long-lived surfaces keep a surface
 * offset, and a note move rewrites every entry pointing at the old path.
 */

export interface NavigateOptions {
  /** Seed the new entry with the target surface's last saved scroll offset. */
  restoreSurfaceScroll?: boolean
  /** Ask the destination to focus its primary input on arrival. */
  focusEditor?: boolean
}

export interface RouterSnapshot {
  readonly route: Route
  readonly entryId: number
  readonly arrivalSeq: number
  readonly arrivalFocusEditor: boolean
  readonly canBack: boolean
  readonly canForward: boolean
  readonly backRoute: Route | null
}

export interface RouterStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RouterSnapshot
  navigate(route: Route, options?: NavigateOptions): void
  back(): void
  forward(): void
  /** Synchronous, monotonic navigation-state revision. */
  navigationRevision(): number
  saveScrollState(offset: number): void
  clearScrollState(): void
  savedScroll(): number | null
  /** Stop following note moves. Call once the store's pane is gone. */
  dispose(): void
}

interface HistoryEntry {
  id: number
  route: Route
}

function scrollSurfaceForRoute(route: Route): string | null {
  switch (route.kind) {
    case 'today':
    case 'daily':
      return 'daily'
    default:
      return null
  }
}

export function createRouterStore(initialRoute: Route = { kind: 'today' }): RouterStore {
  let stack: HistoryEntry[] = [{ id: 0, route: normalizeRoute(initialRoute) }]
  let index = 0
  let arrivalSeq = 0
  // Desktop open-on-today puts the caret in the daily note; mobile keeps the
  // keyboard down until an explicit capture gesture.
  let arrivalFocusEditor = !isMobileSurface() && stack[0]!.route.kind === 'today'
  let nextId = 1
  let revision = 0
  const scrollById = new Map<number, number>()
  const scrollBySurface = new Map<string, number>()
  const listeners = new Set<() => void>()

  function current(): HistoryEntry {
    return stack[index]!
  }

  function buildSnapshot(): RouterSnapshot {
    const entry = current()
    return {
      route: entry.route,
      entryId: entry.id,
      arrivalSeq,
      arrivalFocusEditor,
      canBack: index > 0,
      canForward: index < stack.length - 1,
      backRoute: index > 0 ? stack[index - 1]!.route : null,
    }
  }

  let snapshot = buildSnapshot()

  function emit(): void {
    snapshot = buildSnapshot()
    for (const listener of listeners) {
      listener()
    }
  }

  function navigate(route: Route, options?: NavigateOptions): void {
    revision += 1
    const target = normalizeRoute(route)
    const surface = scrollSurfaceForRoute(target)
    const returning =
      options?.restoreSurfaceScroll === true &&
      surface !== null &&
      scrollSurfaceForRoute(current().route) !== surface
    const restored = returning ? scrollBySurface.get(surface) : undefined
    if (surface !== null && restored === undefined) {
      scrollBySurface.delete(surface)
    }
    const entry = current()
    if (routesEqual(entry.route, target)) {
      if (restored !== undefined) {
        scrollById.set(entry.id, restored)
      } else {
        scrollById.delete(entry.id)
      }
    } else if (entry.route.kind === 'settings' && target.kind === 'settings') {
      stack = stack.map((item, position) =>
        position === index ? { ...item, route: target } : item,
      )
    } else {
      for (const dropped of stack.slice(index + 1)) {
        scrollById.delete(dropped.id)
      }
      const id = nextId++
      if (restored !== undefined) {
        scrollById.set(id, restored)
      }
      stack = [...stack.slice(0, index + 1), { id, route: target }]
      index = stack.length - 1
    }
    arrivalSeq += 1
    arrivalFocusEditor = options?.focusEditor === true
    emit()
  }

  function back(): void {
    if (index === 0) {
      return
    }
    revision += 1
    arrivalFocusEditor = false
    index -= 1
    emit()
  }

  function forward(): void {
    if (index >= stack.length - 1) {
      return
    }
    revision += 1
    arrivalFocusEditor = false
    index += 1
    emit()
  }

  const stopFollowingMoves = onNoteMoved((from, to) => {
    if (current().route.kind === 'note' && current().route.path === from) {
      revision += 1
    }
    let changed = false
    stack = stack.map((entry) => {
      if (entry.route.kind === 'note' && entry.route.path === from) {
        changed = true
        return { ...entry, route: { kind: 'note' as const, path: to } }
      }
      return entry
    })
    if (changed) {
      emit()
    }
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    navigate,
    back,
    forward,
    navigationRevision: () => revision,
    saveScrollState(offset) {
      scrollById.set(current().id, offset)
      const surface = scrollSurfaceForRoute(current().route)
      if (surface !== null) {
        scrollBySurface.set(surface, offset)
      }
    },
    clearScrollState() {
      scrollById.delete(current().id)
      const surface = scrollSurfaceForRoute(current().route)
      if (surface !== null) {
        scrollBySurface.delete(surface)
      }
    },
    savedScroll: () => scrollById.get(current().id) ?? null,
    dispose: stopFollowingMoves,
  }
}
```

Check `onNoteMoved` returns an unsubscribe function (it is used that way in the current `router.tsx` effect). If `current().route.path` does not narrow, read `const entry = current()` first and test `entry.route.kind === 'note' && entry.route.path === from`.

- [ ] **Step 4: Rewrite the provider as a binding**

Replace the body of `apps/desktop/src/routing/router.tsx` (keep the `RouterFreeze` component and the `useRouter` / `useNavigationRevision` hooks exactly as they are):

```tsx
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createRouterStore, type NavigateOptions, type RouterStore } from './router-store'
import type { Route } from './route'

export type { NavigateOptions } from './router-store'

interface RouterValue {
  route: Route
  entryId: number
  arrivalSeq: number
  navigationRevision: () => number
  arrivalFocusEditor: boolean
  navigate: (route: Route, options?: NavigateOptions) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
  backRoute: Route | null
  saveScrollState: (offset: number) => void
  clearScrollState: () => void
  savedScroll: () => number | null
}

const RouterContext = createContext<RouterValue | null>(null)

interface RouterProviderProps {
  /**
   * The store to bind. A workspace pane passes its own; the chrome passes the
   * active pane's. Omitted, the provider owns a private store for its
   * lifetime (mobile, the secondary note window, tests).
   */
  store?: RouterStore | undefined
  /** The launch route for a private store; defaults to today. */
  initialRoute?: Route | undefined
  children: ReactNode
}

/**
 * Bind a {@link RouterStore} to the router context (Plan 06). Every consumer
 * keeps calling `useRouter()`; which pane it addresses is decided by the
 * nearest provider's store.
 */
export function RouterProvider({ store, initialRoute, children }: RouterProviderProps): ReactElement {
  const [own] = useState(() => (store === undefined ? createRouterStore(initialRoute) : null))
  const bound = store ?? own!
  useEffect(() => (own === null ? undefined : own.dispose), [own])
  const snapshot = useSyncExternalStore(bound.subscribe, bound.getSnapshot, bound.getSnapshot)
  const value = useMemo<RouterValue>(
    () => ({
      ...snapshot,
      navigationRevision: bound.navigationRevision,
      navigate: bound.navigate,
      back: bound.back,
      forward: bound.forward,
      saveScrollState: bound.saveScrollState,
      clearScrollState: bound.clearScrollState,
      savedScroll: bound.savedScroll,
    }),
    [snapshot, bound],
  )
  return <RouterContext value={value}>{children}</RouterContext>
}
```

Keep the doc comments from the old `RouterValue` fields (copy them over). Delete the old `HistoryEntry`, `HistoryState`, `scrollSurfaceForRoute`, and the `useState`/`useRef` machinery from `router.tsx`; they now live in the store. `own!` is the one non-null assertion allowed here: write it as `const bound = store ?? own ?? createRouterStore(initialRoute)` if the linter refuses `!`.

- [ ] **Step 5: Run both router tests**

Run: `pnpm --filter @reflect/desktop exec vitest run --project node src/routing/router-store.test.ts && pnpm --filter @reflect/desktop exec vitest run --project browser src/routing/router.test.tsx src/providers/focused-daily-provider.test.tsx src/providers/deep-link-provider.test.tsx`
Expected: all PASS with no changes to `router.test.tsx`.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @reflect/desktop typecheck`

```bash
git add apps/desktop/src/routing/router-store.ts apps/desktop/src/routing/router-store.test.ts apps/desktop/src/routing/router.tsx
git commit -m "refactor: lift router history into an external store"
```

---

### Task 2: Value store and store-bound focused-daily provider

**Files:**
- Create: `apps/desktop/src/lib/value-store.ts`
- Modify: `apps/desktop/src/providers/focused-daily-provider.tsx:36-47`
- Test (existing, unchanged): `apps/desktop/src/providers/focused-daily-provider.test.tsx`

**Interfaces:**
- Produces: `createValueStore<T>(initial: T): ValueStore<T>` with `get()`, `set(value)`, `subscribe(listener)`. `FocusedDailyProvider` gains optional `store?: ValueStore<string | null>`.

- [ ] **Step 1: Write the value store**

`apps/desktop/src/lib/value-store.ts`:

```ts
/** One value behind `useSyncExternalStore`, shareable across provider bindings. */
export interface ValueStore<T> {
  get(): T
  set(value: T): void
  subscribe(listener: () => void): () => void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) {
        return
      }
      value = next
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
```

- [ ] **Step 2: Bind the focused-daily provider to a store**

In `focused-daily-provider.tsx` replace the provider:

```tsx
interface FocusedDailyProviderProps {
  /** Shared with the pane's chrome binding; omitted, the provider owns one. */
  store?: ValueStore<string | null> | undefined
  children: ReactNode
}

export function FocusedDailyProvider({ store, children }: FocusedDailyProviderProps): ReactElement {
  const [own] = useState(() => (store === undefined ? createValueStore<string | null>(null) : null))
  const bound = store ?? own ?? createValueStore<string | null>(null)
  const focusedDate = useSyncExternalStore(bound.subscribe, bound.get, bound.get)
  return (
    <SetFocusedDailyDateContext value={bound.set}>
      <FocusedDailyDateContext value={focusedDate}>{children}</FocusedDailyDateContext>
    </SetFocusedDailyDateContext>
  )
}
```

Add the imports (`useState`, `useSyncExternalStore`, `createValueStore`, `ValueStore`).

- [ ] **Step 3: Run the existing test**

Run: `pnpm --filter @reflect/desktop exec vitest run --project browser src/providers/focused-daily-provider.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/value-store.ts apps/desktop/src/providers/focused-daily-provider.tsx
git commit -m "refactor: let FocusedDailyProvider bind a shared store"
```

---

### Task 3: Per-pane tab persistence in core settings

**Files:**
- Modify: `packages/core/src/settings/schema.ts` (around lines 138, 232-236, and the `openTabsSchema` doc comment)
- Test: `packages/core/src/settings/schema.test.ts` (existing `openTabs` cases at ~line 701 and 730 change shape)

**Interfaces:**
- Produces: `export interface OpenPane { readonly id: string; readonly tabs: OpenTab[]; readonly activeKey: string | null }`; `settings.openTabs` is `Record<string, OpenPane[]>`.

- [ ] **Step 1: Update the schema test**

Find the two tests around lines 701 and 730 in `schema.test.ts` that assert `parsed.openTabs`. Change their inputs and expectations to the pane shape, e.g.:

```ts
openTabs: {
  '/graph': [
    {
      id: 'main',
      activeKey: 'note:notes/a.md',
      tabs: [{ kind: 'note', path: 'notes/a.md', pinned: false }],
    },
  ],
},
```

Add one test:

```ts
it('drops a pre-pane flat tab list instead of resurrecting it', () => {
  const parsed = parseSettings({
    openTabs: { '/graph': [{ kind: 'note', path: 'notes/a.md', pinned: false }] },
  })
  expect(parsed.openTabs).toEqual({ '/graph': [] })
})
```

Use whichever parse helper the file already uses for the other `openTabs` tests (`parseSettings` or `settingsSchema.parse`, match the file).

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @reflect/core test --run src/settings/schema.test.ts`
Expected: FAIL on the changed expectations.

- [ ] **Step 3: Change the schema**

Next to `export type OpenTab = ...` (line ~138) add:

```ts
/** One workspace pane's persisted tab strip and the tab it last showed. */
export interface OpenPane {
  readonly id: string
  readonly tabs: OpenTab[]
  /** `tabKey` of the pane's active tab, or null when it has none yet. */
  readonly activeKey: string | null
}
```

Replace `openTabsSchema`:

```ts
const openPaneSchema: z.ZodType<OpenPane> = z.object({
  id: z.string().min(1),
  tabs: z.preprocess(dropRetiredWorkspaceTabs, z.array(openTabSchema).catch([])),
  activeKey: z.string().nullable().catch(null),
})

/**
 * Per graph root, the ordered panes of the workspace, each with its tab
 * strip. A malformed pane (including the pre-pane flat tab list) drops the
 * graph's panes rather than restoring half a session.
 */
export const openTabsSchema = z
  .record(z.string(), z.array(openPaneSchema).catch([]))
  .refine((value) => !Array.isArray(value))
  .catch({})
```

Export `OpenPane` from wherever `OpenTab` is re-exported (check `packages/core/src/index.ts` or `settings/index`; `grep -rn "OpenTab" packages/core/src/index.ts`).

- [ ] **Step 4: Run core tests and typecheck**

Run: `pnpm --filter @reflect/core test --run src/settings/schema.test.ts && pnpm --filter @reflect/core typecheck`
Expected: PASS. The desktop typecheck will now fail in `open-tabs-provider.tsx`; Task 5 fixes it.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings/schema.ts packages/core/src/settings/schema.test.ts packages/core/src/index.ts
git commit -m "feat: persist workspace tabs per pane"
```

---

### Task 4: PanesProvider

**Files:**
- Create: `apps/desktop/src/providers/panes-provider.tsx`
- Test: `apps/desktop/src/providers/panes-provider.test.tsx`

**Interfaces:**
- Consumes: `createRouterStore`, `createValueStore`, `OpenPane`, `openTabForRoute`, `tabKey`, `tabsEqual`, `useSettings`, `useGraph`, `NoteFindActions`.
- Produces:

```ts
export interface WorkspacePaneHandle {
  readonly id: string
  readonly router: RouterStore
  readonly focusedDaily: ValueStore<string | null>
}
export interface PanesValue {
  readonly panes: readonly WorkspacePaneHandle[]
  readonly activePane: WorkspacePaneHandle
  setActivePane(id: string): void
  /** Open `route` in the pane right of `from`, creating one; a route whose tab is already open in some pane activates that pane instead. */
  openInPane(route: Route, options: { from: string }): void
  /** Close a pane; the last pane never closes. */
  closePane(id: string): void
  focusPane(target: 'left' | 'right'): void
  registerFindActions(id: string, actions: NoteFindActions | null): void
  activeFindActions(): NoteFindActions | null
}
export function PanesProvider(props: { initialRoute?: Route; children: ReactNode }): ReactElement
export function usePanes(): PanesValue
/** The id of the pane this component renders in, or the active pane outside one. */
export function usePaneId(): string
```

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/providers/panes-provider.test.tsx`:

```tsx
import { renderHook } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { GraphProvider } from '@/providers/graph-provider'
import { SettingsProvider } from '@/providers/settings-provider'
import { PanesProvider, usePanes } from './panes-provider'

// Mirror the wrapper used by `open-tabs-provider`'s nearest test or by
// `sidebar-width.test.tsx` for a settings + graph harness; copy its setup
// (dev bridge install, graph fixture) verbatim here.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <GraphProvider>
        <PanesProvider>{children}</PanesProvider>
      </GraphProvider>
    </SettingsProvider>
  )
}

describe('PanesProvider', () => {
  it('starts with one pane on today', async () => {
    const { result } = await renderHook(usePanes, { wrapper })
    expect(result.current.panes).toHaveLength(1)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({ kind: 'today' })
  })

  it('opens in a new pane to the right, then reuses it', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() => result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }))
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.id).not.toBe(first)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/a.md' })

    await act(() => result.current.openInPane({ kind: 'note', path: 'notes/b.md' }, { from: first }))
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/b.md' })
  })

  it('activates the pane that already shows a route instead of duplicating it', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() => result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }))
    const second = result.current.activePane.id
    await act(() => result.current.setActivePane(first))
    await act(() => result.current.openInPane({ kind: 'today' }, { from: second }))
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.id).toBe(first)
  })

  it('closes a pane but never the last one', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() => result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }))
    const second = result.current.activePane.id
    await act(() => result.current.closePane(second))
    expect(result.current.panes.map((pane) => pane.id)).toEqual([first])
    await act(() => result.current.closePane(first))
    expect(result.current.panes).toHaveLength(1)
  })
})
```

Before writing, open `apps/desktop/src/providers/sidebar-width.test.tsx` and `apps/desktop/src/providers/settings-provider.test.tsx` and copy the exact harness they use to get a `SettingsProvider` + graph with an in-memory bridge (look for `installDevBridge`, `setBridge`, or a `renderWithProviders` helper in `apps/desktop/src/test-utils/`). The wrapper above is a sketch of intent; the provider names and props must match what those tests do.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @reflect/desktop exec vitest run --project browser src/providers/panes-provider.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the provider**

`apps/desktop/src/providers/panes-provider.tsx`:

```tsx
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

export function PanesProvider({ initialRoute, children }: PanesProviderProps): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { graph } = useGraph()
  const root = graph?.root ?? null
  const stored = root === null ? [] : (settings.openTabs[root] ?? [])

  const handles = useRef(new Map<string, WorkspacePaneHandle>())
  const findActions = useRef(new Map<string, NoteFindActions>())

  // Pane 1 always launches on today (or the window's own initial route); a
  // restored extra pane reopens its last active tab and is dropped when it
  // has none. Handles are created once per id and reused across renders.
  const panes = useMemo<WorkspacePaneHandle[]>(() => {
    const restored = stored.filter((pane, position) => position === 0 || restoredRoute(pane) !== null)
    const entries = restored.length === 0 ? [{ id: MAIN_PANE_ID, tabs: [], activeKey: null }] : restored
    return entries.map((pane, position) => {
      const existing = handles.current.get(pane.id)
      if (existing !== undefined) {
        return existing
      }
      const route = position === 0 ? initialRoute : (restoredRoute(pane) ?? undefined)
      const handle = createPaneHandle(pane.id, route)
      handles.current.set(pane.id, handle)
      return handle
    })
  }, [stored, initialRoute])

  const [activeId, setActiveId] = useState<string>(() => panes[0]!.id)
  const activePane = panes.find((pane) => pane.id === activeId) ?? panes[0]!

  // Drop handles whose pane entry disappeared from settings.
  useEffect(() => {
    const live = new Set(panes.map((pane) => pane.id))
    for (const [id, handle] of handles.current) {
      if (!live.has(id)) {
        handle.router.dispose()
        handles.current.delete(id)
        findActions.current.delete(id)
      }
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

  const openInPane = useCallback(
    (route: Route, { from }: { from: string }) => {
      const tab = openTabForRoute(route)
      if (tab !== null) {
        const holder = stored.find((pane) => pane.tabs.some((open) => tabsEqual(open, tab)))
        const holderHandle = holder === undefined ? undefined : handles.current.get(holder.id)
        if (holderHandle !== undefined) {
          holderHandle.router.navigate(route)
          setActiveId(holderHandle.id)
          return
        }
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
        const base = graphPanes.length === 0 ? panes.map((pane) => ({ id: pane.id, tabs: [], activeKey: null })) : graphPanes
        const insertAt = base.findIndex((pane) => pane.id === from) + 1
        return [...base.slice(0, insertAt), { id, tabs: [], activeKey: null }, ...base.slice(insertAt)]
      })
    },
    [stored, panes, writePanes],
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
      if (id === activeId) {
        const neighbor = panes[index + 1] ?? panes[index - 1]
        if (neighbor !== undefined) {
          setActiveId(neighbor.id)
        }
      }
      writePanes((graphPanes) => graphPanes.filter((pane) => pane.id !== id))
    },
    [panes, activeId, writePanes],
  )

  const focusPane = useCallback(
    (target: 'left' | 'right') => {
      const index = panes.findIndex((pane) => pane.id === activeId)
      const next = panes[target === 'left' ? index - 1 : index + 1]
      if (next !== undefined) {
        setActiveId(next.id)
      }
    },
    [panes, activeId],
  )

  const registerFindActions = useCallback((id: string, actions: NoteFindActions | null) => {
    if (actions === null) {
      findActions.current.delete(id)
    } else {
      findActions.current.set(id, actions)
    }
  }, [])

  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
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
      closePane,
      focusPane,
      registerFindActions,
      activeFindActions,
    }),
    [panes, activePane, setActivePane, openInPane, closePane, focusPane, registerFindActions, activeFindActions],
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

/**
 * Safe no-op model for surfaces mounted without panes (the secondary note
 * window, mobile, unit harnesses): one pane, every action inert.
 */
export function useOptionalPanes(): PanesValue | null {
  return use(PanesContext)
}

/** Mark a subtree as rendering inside one pane. */
export function PaneScope({ id, children }: { id: string; children: ReactNode }): ReactElement {
  return <PaneIdContext value={id}>{children}</PaneIdContext>
}

/** The id of the enclosing pane, or the active pane's id outside any pane. */
export function usePaneId(): string {
  const scoped = use(PaneIdContext)
  const panes = use(PanesContext)
  return scoped ?? panes?.activePane.id ?? MAIN_PANE_ID
}
```

Notes for the implementer:
- `openTabForRoute(route)` is called with no conversation id: chat routes are never opened through links.
- When `stored` is empty the pane list is the synthesized `main` pane; `openInPane`'s `writePanes` seeds it into settings before inserting the new pane (the `base` computation).
- `crypto.randomUUID()` is already used by the command palette; no polyfill.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @reflect/desktop exec vitest run --project browser src/providers/panes-provider.test.tsx`
Expected: PASS (4 tests). If the "reuses it" case fails because `stored` lags the write, confirm `updateSettingsWith` updates local state synchronously (it does for the tab strip); if not, read the fresh value inside `writePanes` instead of `stored` for the holder lookup.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/providers/panes-provider.tsx apps/desktop/src/providers/panes-provider.test.tsx
git commit -m "feat: add the workspace panes model"
```

---

### Task 5: Per-pane OpenTabsProvider

**Files:**
- Modify: `apps/desktop/src/providers/open-tabs-provider.tsx`
- Test: nearest existing tests of the strip/provider (`grep -rl OpenTabsProvider apps/desktop/src --include='*.test.tsx'`); update their wrappers to `<OpenTabsProvider paneId="main">` inside a `PanesProvider`.

**Interfaces:**
- Consumes: `OpenPane`, `usePanes` (`closePane`, `panes`).
- Produces: `OpenTabsProvider({ paneId, children })`. `OpenTabsValue` unchanged.

- [ ] **Step 1: Update the provider**

In `open-tabs-provider.tsx`:

1. Props: `export function OpenTabsProvider({ paneId, children }: { paneId: string; children: ReactNode })`.
2. Replace the `stored`/`tabs` derivation:

```ts
const stored = settings.openTabs
const pane = useMemo(
  () => (root === null ? undefined : stored[root]?.find((entry) => entry.id === paneId)),
  [stored, root, paneId],
)
const tabs = useMemo(() => stripOrder(pane?.tabs ?? []), [pane])
```

3. Replace `updateTabs` so it mutates only this pane's slice and creates the pane entry when missing:

```ts
const updateTabs = useCallback(
  (mutate: (tabs: OpenTab[]) => OpenTab[]) => {
    if (root === null) {
      return
    }
    updateSettingsWith((current) => {
      const graphPanes = current.openTabs[root] ?? []
      const existing = graphPanes.find((entry) => entry.id === paneId)
      const paneTabs = existing?.tabs ?? []
      const next = mutate(paneTabs)
      const unchanged =
        existing !== undefined &&
        (next === paneTabs ||
          (next.length === paneTabs.length && next.every((tab, index) => tab === paneTabs[index])))
      if (unchanged) {
        return {}
      }
      const updated: OpenPane = { id: paneId, tabs: next, activeKey: existing?.activeKey ?? null }
      const panes =
        existing === undefined
          ? [...graphPanes, updated]
          : graphPanes.map((entry) => (entry.id === paneId ? updated : entry))
      return { openTabs: { ...current.openTabs, [root]: panes } }
    })
  },
  [root, paneId, updateSettingsWith],
)
```

4. Record the active tab key so a relaunch restores the pane. Extend the existing "every visited route becomes a tab" effect: after computing `incoming`, also write `activeKey`. Simplest: inside the same `updateSettingsWith` call, set `activeKey: tabKey(incoming)` on the updated pane. Refactor `updateTabs` to accept an optional `activeKey?: string` second argument used when building `updated`; pass `tabKey(incoming)` from that effect only.

5. Closing the last tab closes the pane when another pane exists. In `closeTab`, before the `updateTabs` call:

```ts
const remainingCount = tabs.filter((open) => !tabsEqual(open, tab)).length
if (remainingCount === 0 && panes.panes.length > 1) {
  panes.closePane(paneId)
  return
}
```

with `const panes = usePanes()` at the top. Keep the existing "else Daily" fallback for the single-pane case.

- [ ] **Step 2: Fix the existing tests' wrappers and run them**

Run: `pnpm --filter @reflect/desktop exec vitest run --project browser $(grep -rl 'OpenTabsProvider' apps/desktop/src --include='*.test.tsx' | sed 's|apps/desktop/||')`
Expected: PASS after wrapping with `PanesProvider` and passing `paneId="main"`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @reflect/desktop typecheck`
Expected: errors only where `OpenTabsProvider` is mounted without `paneId` (`graph-workspace.tsx`), fixed in Task 7.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/providers/open-tabs-provider.tsx apps/desktop/src/**/*.test.tsx
git commit -m "feat: scope open tabs to a workspace pane"
```

---

### Task 6: Split intent on note links

**Files:**
- Modify: `apps/desktop/src/hooks/use-note-link-navigation.ts`
- Modify (mechanical rename `openInNewWindow` → `openInSplit`): every file listed by `grep -rl 'openInNewWindow' apps/desktop/src` **except** `lib/windows/open-in-new-window.ts` and `lib/commands/app-commands.ts` (those keep the `openRouteInNewWindow` / `note.openInNewWindow` names, which still mean a real window).
- Test: `apps/desktop/src/hooks/use-note-link-navigation.test.tsx` if present (`ls apps/desktop/src/hooks/use-note-link-navigation*`), else `apps/desktop/src/lib/deep-links/use-follow-deep-link.test.tsx` for the rename only.

**Interfaces:**
- Produces: `NoteLinkNavigation = (options: { target: NoteRoute; openInSplit: boolean }) => void`.

- [ ] **Step 1: Rename the option everywhere**

```bash
grep -rl 'openInNewWindow' apps/desktop/src | grep -v 'lib/windows/open-in-new-window.ts' | grep -v 'lib/commands/app-commands.ts' | xargs sed -i '' 's/openInNewWindow/openInSplit/g'
```

Then `grep -rn 'openInSplit' apps/desktop/src/lib/deep-links/use-follow-deep-link.ts`: the deep-link follower keeps its flag name but, per deviation 5, its body becomes: `dispatchDeepLink(href)` regardless of the flag. Delete the `openDeepLinkInNewWindow` branch and the now-unused import; delete `openDeepLinkInNewWindow` from `open-in-new-window.ts` if nothing else imports it (`grep -rn openDeepLinkInNewWindow apps/desktop/src`). Update its test to assert in-place dispatch for a modifier follow.

- [ ] **Step 2: Rewrite `useNoteLinkNavigation`**

```ts
import { useCallback } from 'react'
import { useOptionalPanes, usePaneId } from '@/providers/panes-provider'
import type { NoteRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'

/** Open one concrete note from a link-like UI control. */
export type NoteLinkNavigation = (options: { target: NoteRoute; openInSplit: boolean }) => void

/**
 * The app-wide note-link convention: `openInSplit` (decided at the UI
 * boundary from a ⌘/Ctrl click or a spare-`mod` keyboard follow) opens the
 * note in the pane beside this one; otherwise navigate in place. Surfaces
 * without panes (the secondary note window, mobile) navigate in place either
 * way, so the modifier can never make a link do nothing.
 */
export function useNoteLinkNavigation(): NoteLinkNavigation {
  const { navigate } = useRouter()
  const panes = useOptionalPanes()
  const paneId = usePaneId()

  return useCallback(
    ({ target, openInSplit }) => {
      if (openInSplit && panes !== null) {
        panes.openInPane(target, { from: paneId })
        return
      }
      navigate(target)
    },
    [navigate, panes, paneId],
  )
}
```

The `scopeKey` parameter and `useLinkIntentGuard` were only there for the async window-open fallback; remove the parameter and fix the two callers that passed one (`grep -rn 'useNoteLinkNavigation(' apps/desktop/src`).

- [ ] **Step 3: Run the affected tests**

Run: `pnpm --filter @reflect/desktop exec vitest run --project browser src/hooks src/lib/deep-links src/editor/use-wiki-link-navigation.test.tsx src/components/command-palette`
Expected: PASS (adjust assertions that expected a window open on a modifier click to expect in-place or split navigation; keep the count of changed tests minimal).

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @reflect/desktop typecheck` (remaining errors must be only in `graph-workspace.tsx`).

```bash
git add -A apps/desktop/src
git commit -m "feat: modifier-click on a note link opens it in a split"
```

---

### Task 7: WorkspacePane and the pane row

**Files:**
- Create: `apps/desktop/src/components/workspace-pane.tsx`
- Modify: `apps/desktop/src/components/workspace-content.tsx:130-193`
- Modify: `apps/desktop/src/components/graph-workspace.tsx:46-90`
- Modify: `apps/desktop/src/providers/note-find-provider.tsx` (register actions)
- Test: `apps/desktop/src/components/workspace-pane.test.tsx`

**Interfaces:**
- Consumes: `PanesProvider`, `PaneScope`, `usePanes`, `RouterProvider({ store })`, `FocusedDailyProvider({ store })`, `OpenTabsProvider({ paneId })`, `NoteFindProvider`, `WorkspaceTabsStrip`, `RouteContent`, `NoteFindBar`, `AppShell`.
- Produces: `WorkspacePane({ pane, commandContext })`.

- [ ] **Step 1: Register find actions from the note-find provider**

In `note-find-provider.tsx`, after `const actions = useMemo<NoteFindActions>(...)`:

```ts
const panes = useOptionalPanes()
const paneId = usePaneId()
useEffect(() => {
  if (panes === null) return
  panes.registerFindActions(paneId, actions)
  return () => panes.registerFindActions(paneId, null)
}, [panes, paneId, actions])
```

- [ ] **Step 2: Write the pane component**

`apps/desktop/src/components/workspace-pane.tsx`:

```tsx
import { useCallback, type ReactElement } from 'react'
import { AppShell } from '@/components/app-shell'
import { NoteFindBar } from '@/components/note-find-bar'
import { WorkspaceTabsStrip } from '@/components/note-tabs-strip'
import { RouteContent } from '@/components/route-content'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { FocusedDailyProvider } from '@/providers/focused-daily-provider'
import { NoteFindProvider } from '@/providers/note-find-provider'
import { OpenTabsProvider } from '@/providers/open-tabs-provider'
import { PaneScope, usePanes, type WorkspacePaneHandle } from '@/providers/panes-provider'
import { RouterProvider } from '@/routing/router'

interface WorkspacePaneProps {
  pane: WorkspacePaneHandle
  commandContext: CommandContext
}

/**
 * One column of the workspace: its own router history, tab strip, focused
 * daily day, and Find session, bound to the pane's stores so everything
 * inside addresses this pane. Pointer or keyboard focus anywhere inside
 * makes it the active pane, which is what the chrome (sidebar, palette,
 * context rail) follows.
 */
export function WorkspacePane({ pane, commandContext }: WorkspacePaneProps): ReactElement {
  const { activePane, setActivePane } = usePanes()
  const active = activePane.id === pane.id
  const activate = useCallback(() => {
    if (!active) setActivePane(pane.id)
  }, [active, pane.id, setActivePane])

  return (
    <PaneScope id={pane.id}>
      <RouterProvider store={pane.router}>
        <FocusedDailyProvider store={pane.focusedDaily}>
          <OpenTabsProvider paneId={pane.id}>
            <NoteFindProvider>
              <div
                data-testid="workspace-pane"
                data-active={active ? 'true' : undefined}
                onPointerDownCapture={activate}
                onFocusCapture={activate}
                className="workspace-main flex min-w-[360px] flex-1 flex-col"
              >
                <WorkspaceTabsStrip commandContext={commandContext} />
                <div className="workspace-pane-gutter min-h-0 flex-1 pl-2 pb-2">
                  <div
                    className={cn(
                      'app-glass-card h-full overflow-hidden rounded-xl bg-surface',
                      !active && 'opacity-95',
                    )}
                  >
                    <AppShell className="bg-transparent">
                      <div className="relative flex h-full flex-col">
                        <div className="min-h-0 flex-1">
                          <RouteContent />
                        </div>
                        <NoteFindBar />
                      </div>
                    </AppShell>
                  </div>
                </div>
              </div>
            </NoteFindProvider>
          </OpenTabsProvider>
        </FocusedDailyProvider>
      </RouterProvider>
    </PaneScope>
  )
}
```

Visual cue for the active pane: in `note-tabs-strip.tsx`, read `const active = usePanes().activePane.id === usePaneId()` and give the active tab pill its current styling while an inactive pane's active pill uses the muted text color (`text-text-muted`). Keep it to one class toggle.

- [ ] **Step 3: Replace the middle column in `WorkspaceFrame`**

In `workspace-content.tsx`, replace the `workspace-main` block (the `<div className="workspace-main ...">` through its closing tag) with:

```tsx
{panes.map((pane, index) => (
  <Fragment key={pane.id}>
    {index > 0 ? <PaneResizeHandle leftPaneId={panes[index - 1]!.id} /> : null}
    <WorkspacePane pane={pane} commandContext={commandContext} />
  </Fragment>
))}
```

with `const { panes } = usePanes()` in `WorkspaceFrame`. For the resize handle, add a small component at the bottom of `workspace-pane.tsx`:

```tsx
/**
 * Divider between two panes. Drag sets the left pane's flex-basis in pixels
 * for this session only; widths reset on relaunch by design.
 */
export function PaneResizeHandle({ leftPaneId }: { leftPaneId: string }): ReactElement {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    const left = handle.previousElementSibling
    if (!(left instanceof HTMLElement)) return
    const startX = event.clientX
    const startWidth = left.getBoundingClientRect().width
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      left.style.flex = `0 0 ${Math.max(360, startWidth + move.clientX - startX)}px`
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize pane"
      data-left-pane={leftPaneId}
      onPointerDown={onPointerDown}
      className="w-2 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:w-0.5 after:bg-border-strong after:opacity-0 hover:after:opacity-60 relative"
    />
  )
}
```

- [ ] **Step 4: Mount `PanesProvider` in `graph-workspace.tsx`**

Main window branch only. Restructure lines 46-90 so that:

- The outer `RouterProvider` remains for the **secondary window** branch only (`NoteWindowContent`), still with `initialRoute`.
- For the main window, the tree becomes:

```tsx
<PanesProvider key={graph.root}>
  <ActivePaneChrome>
    ...SyncProvider, PaletteProvider, ShortcutsProvider, VaultReplaceProvider, NoteTemplatesProvider,
       SidebarProvider, AudioMemoProvider, CaptureProvider, DeepLinkProvider, AssetDescribeProvider,
       ChatProvider, V1ImportProvider, then <WorkspaceContent graph={graph} />
  </ActivePaneChrome>
</PanesProvider>
```

where `ActivePaneChrome` (a small component in `graph-workspace.tsx` or `workspace-pane.tsx`) binds the chrome to the active pane:

```tsx
function ActivePaneChrome({ children }: { children: ReactNode }): ReactElement {
  const { activePane } = usePanes()
  return (
    <RouterProvider store={activePane.router}>
      <FocusedDailyProvider store={activePane.focusedDaily}>
        <OpenTabsProvider paneId={activePane.id}>{children}</OpenTabsProvider>
      </FocusedDailyProvider>
    </RouterProvider>
  )
}
```

`PanesProvider` needs `SettingsProvider` and `GraphProvider` above it; both are mounted above `GraphWorkspace` already (`useSettings`/`useGraph` are called inside `GraphWorkspace` today). Remove the top-level `NoteFindProvider` and `FocusedDailyProvider` from the main-window branch (they now live per pane and in `ActivePaneChrome`); keep both around `NoteWindowContent`.

`ChatProvider` and `OpenTabsProvider` order: `OpenTabsProvider` calls `useOptionalChatSession()`, so `ActivePaneChrome` must sit **below** `ChatProvider`. Place `ActivePaneChrome` directly around `V1ImportProvider` + `WorkspaceContent`, inside `ChatProvider`. The providers between `PanesProvider` and `ActivePaneChrome` that call `useRouter()` (`DeepLinkProvider`) must also be inside a router binding: mount a second, chrome-level `<RouterProvider store={activePane.router}>` just below `PanesProvider` via a tiny `ActivePaneRouter` component, and let `ActivePaneChrome` bind only focused-daily and tabs. Two bindings of the same store are fine.

- [ ] **Step 5: Write the pane test**

`apps/desktop/src/components/workspace-pane.test.tsx` (use the same providers harness as Task 4's test plus a `PanesProvider`, and render two `WorkspacePane`s):

```tsx
import { render } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import { userEvent } from '@vitest/browser/context'
import { usePanes } from '@/providers/panes-provider'
import { WorkspacePane } from './workspace-pane'

function TwoPanes(): ReactElement {
  const { panes } = usePanes()
  return (
    <div className="flex">
      {panes.map((pane) => (
        <WorkspacePane key={pane.id} pane={pane} commandContext={stubCommandContext()} />
      ))}
    </div>
  )
}

describe('WorkspacePane', () => {
  it('clicking inside a pane makes it the active one', async () => {
    const screen = await render(<Harness><TwoPanes /></Harness>)
    // Open a second pane through the model, then click into the first.
    ...
    const panes = screen.getByTestId('workspace-pane').all()
    expect(panes).toHaveLength(2)
    await userEvent.click(panes[0]!)
    await expect.element(panes[0]!).toHaveAttribute('data-active', 'true')
    await expect.element(panes[1]!).not.toHaveAttribute('data-active')
  })
})
```

Fill `Harness` and `stubCommandContext` from what `note-tabs-strip.test.tsx` (or the closest strip test) already does; the intent is one browser test proving focus switching, nothing more.

- [ ] **Step 6: Run tests on both engines and typecheck**

Run:
```bash
pnpm --filter @reflect/desktop typecheck
pnpm --filter @reflect/desktop exec vitest run --project browser src/components/workspace-pane.test.tsx src/providers/panes-provider.test.tsx src/routing/router.test.tsx
REFLECT_TEST_BROWSER=webkit pnpm --filter @reflect/desktop exec vitest run --project browser src/components/workspace-pane.test.tsx src/providers/panes-provider.test.tsx
```
Expected: PASS on both.

- [ ] **Step 7: Commit**

```bash
git add -A apps/desktop/src
git commit -m "feat: show notes side by side in workspace panes"
```

---

### Task 8: Pane commands and chrome wiring

**Files:**
- Modify: `apps/desktop/src/lib/commands/types.ts`
- Modify: `apps/desktop/src/lib/commands/app-commands.ts` (near `tabs.close`, line ~304)
- Modify: `apps/desktop/src/routing/app-shortcuts.ts:165-260`
- Test: `apps/desktop/src/routing/app-shortcuts.test.tsx` (add one case)

**Interfaces:**
- Produces on `CommandContext`: `closePane(): void`, `focusPane(target: 'left' | 'right'): void`. Commands `pane.close`, `pane.focusLeft` (`Mod-Alt-ArrowLeft`), `pane.focusRight` (`Mod-Alt-ArrowRight`).

- [ ] **Step 1: Extend the context type**

In `types.ts` next to `closeActiveTab`:

```ts
/** Close the active pane (never the last one). */
closePane: () => void
/** Move the active pane one column left or right. */
focusPane: (target: 'left' | 'right') => void
```

- [ ] **Step 2: Add the commands**

In `app-commands.ts` after the `tabs.close` entry:

```ts
{
  id: 'pane.close',
  title: 'Close pane',
  keywords: ['split', 'pane', 'column', 'close'],
  run: (context) => context.closePane(),
},
{
  id: 'pane.focusLeft',
  title: 'Focus pane on the left',
  keywords: ['split', 'pane', 'column', 'focus'],
  keybinding: 'Mod-Alt-ArrowLeft',
  run: (context) => context.focusPane('left'),
},
{
  id: 'pane.focusRight',
  title: 'Focus pane on the right',
  keywords: ['split', 'pane', 'column', 'focus'],
  keybinding: 'Mod-Alt-ArrowRight',
  run: (context) => context.focusPane('right'),
},
```

Check the keybinding grammar used by other entries for arrow keys (`grep -rn "Arrow" apps/desktop/src/editor/keymap.ts apps/desktop/src/lib/commands`); if the keymap expects `Mod-Alt-Left`, use that spelling.

- [ ] **Step 3: Wire the context in `useAppShortcuts`**

Add `const panes = usePanes()` and, in the `useMemo` context object:

```ts
closePane: () => panes.closePane(panes.activePane.id),
focusPane: panes.focusPane,
```

Add `panes` to the memo deps. Replace the find plumbing: remove `useNoteFindActions()` here and define

```ts
openNoteFind: () => {
  panes.activeFindActions()?.openForPath(
    focusedNotePathForRoute(routeRef.current, todayIso(), focusedDailyDateRef.current),
  )
},
findNextInNote: () => panes.activeFindActions()?.next(),
findPreviousInNote: () => panes.activeFindActions()?.previous(),
```

`useAppShortcuts` is only mounted in the main window (`WorkspaceContent`), so `usePanes()` is safe there.

- [ ] **Step 4: Add a shortcut test**

In `app-shortcuts.test.tsx`, following the pattern of an existing keybinding case, assert that `Mod-Alt-ArrowRight` calls `focusPane('right')` on the context (mock `usePanes` the same way the file mocks other providers, or wrap in a real `PanesProvider` and assert the active pane id changes after opening a second pane).

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @reflect/desktop exec vitest run --project browser src/routing/app-shortcuts.test.tsx src/routing/app-shortcuts-macos.test.tsx && pnpm --filter @reflect/desktop typecheck`

```bash
git add apps/desktop/src/lib/commands apps/desktop/src/routing
git commit -m "feat: keyboard commands to close and switch workspace panes"
```

---

### Task 9: Full verification

- [ ] **Step 1: Repo check**

Run: `pnpm check`
Expected: typecheck and lint clean. Fix anything reported; do not widen scope.

- [ ] **Step 2: Targeted suites on both engines**

```bash
pnpm --filter @reflect/desktop exec vitest run --project node src/routing src/providers/open-tab.test.ts
pnpm --filter @reflect/desktop exec vitest run --project browser src/routing src/providers src/components/workspace-pane.test.tsx src/components/note-tabs-strip.test.tsx src/hooks src/lib/deep-links
REFLECT_TEST_BROWSER=webkit pnpm --filter @reflect/desktop exec vitest run --project browser src/routing src/providers src/components/workspace-pane.test.tsx
pnpm --filter @reflect/core test --run src/settings
```

Record exact counts (files, tests, failures) for the final report.

- [ ] **Step 3: Manual smoke in the browser dev harness**

Start `pnpm dev` in the background, open `http://localhost:1420`, and check: ⌘-click a wiki link opens it in a second column; ⌘-clicking another link from the first column replaces the second column's note; ⌘W on the second column's only tab closes the column; ⌘⌥← / ⌘⌥→ move the highlighted strip; the context sidebar follows the active column. Screenshot the two-pane state for the PR.

- [ ] **Step 4: Update `docs/STATE.md` if the program tracks UI work there** (read it first; add a line only if a matching section exists), then commit any leftovers.
