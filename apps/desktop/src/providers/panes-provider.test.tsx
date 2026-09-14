import { StrictMode, useSyncExternalStore, type ReactNode } from 'react'
import { renderHook } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenColumn, OpenTab } from '@reflect/core'
import { emitNoteMoved } from '@/lib/note-moves'
import type { NoteFindActions } from '@/providers/note-find-provider'
import { PanesProvider, usePanes } from './panes-provider'

const GRAPH_ROOT = '/graph'

/**
 * The settings and graph hooks are mocked rather than mounted (the pattern
 * `sidebar-width.test.tsx` uses): a tiny external store stands in for the
 * settings document so `updateSettingsWith` re-renders the hook under test
 * exactly like the real provider does.
 */
const settingsStore = vi.hoisted(() => {
  interface Doc {
    openTabs: Record<string, OpenColumn[]>
  }
  let doc: Doc = { openTabs: {} }
  const listeners = new Set<() => void>()
  function emit(): void {
    for (const listener of listeners) {
      listener()
    }
  }
  return {
    get: (): Doc => doc,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(updater: (current: Doc) => Partial<Doc>): void {
      doc = { ...doc, ...updater(doc) }
      emit()
    },
    reset(): void {
      doc = { openTabs: {} }
      emit()
    },
  }
})

vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: useSyncExternalStore(settingsStore.subscribe, settingsStore.get),
    updateSettingsWith: settingsStore.update,
  }),
}))

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: GRAPH_ROOT } }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <PanesProvider>{children}</PanesProvider>
}

function strictWrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <PanesProvider>{children}</PanesProvider>
    </StrictMode>
  )
}

function stubFindActions(): NoteFindActions {
  return {
    openForPath: () => true,
    next: () => {},
    previous: () => {},
    close: () => {},
  }
}

/**
 * What the pane's own `OpenTabsProvider` would have persisted for it. Before
 * the first split nothing is written at all, so an untouched document gets
 * the main column the provider synthesizes.
 */
function seedPaneTabs(paneId: string, tabs: OpenTab[], activeKey: string | null): void {
  settingsStore.update((current) => ({
    openTabs: {
      ...current.openTabs,
      [GRAPH_ROOT]: (
        current.openTabs[GRAPH_ROOT] ?? [
          { id: 'main', panes: [{ id: paneId, tabs: [], activeKey: null }] },
        ]
      ).map((column) => ({
        ...column,
        panes: column.panes.map((pane) =>
          pane.id === paneId ? { ...pane, tabs, activeKey } : pane,
        ),
      })),
    },
  }))
}

function storedPane(paneId: string) {
  return (settingsStore.get().openTabs[GRAPH_ROOT] ?? [])
    .flatMap((column) => column.panes)
    .find((pane) => pane.id === paneId)
}

afterEach(() => {
  settingsStore.reset()
})

describe('PanesProvider', () => {
  it('starts with one pane on today', async () => {
    const { result } = await renderHook(usePanes, { wrapper })
    expect(result.current.panes).toHaveLength(1)
    expect(result.current.columns).toHaveLength(1)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({ kind: 'today' })
  })

  it('opens in a new pane to the right, then reuses it', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.id).not.toBe(first)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/a.md',
    })

    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/b.md' }, { from: first }),
    )
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/b.md',
    })
  })

  it('opens below: a second pane in the same column', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane(
        { kind: 'note', path: 'notes/a.md' },
        { from: first, placement: 'below' },
      ),
    )
    expect(result.current.columns).toHaveLength(1)
    expect(result.current.columns[0]!.panes.map((pane) => pane.id)).toEqual([
      first,
      result.current.activePane.id,
    ])
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/a.md',
    })
  })

  it('opens right: a new column after the source column', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    expect(result.current.columns).toHaveLength(2)
    expect(result.current.columns[0]!.panes.map((pane) => pane.id)).toEqual([first])
    expect(result.current.columns[1]!.panes).toHaveLength(1)
  })

  it('activates the pane that already shows a route instead of duplicating it', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    const second = result.current.activePane.id

    // Dedupe reads the *persisted* tabs, and no OpenTabsProvider is mounted
    // here: give the first pane the Daily tab it would own in the real app.
    await act(() =>
      seedPaneTabs(
        first,
        [{ kind: 'surface', surface: 'daily', date: null, pinned: false }],
        'surface:daily',
      ),
    )

    await act(() => result.current.setActivePane(first))
    await act(() => result.current.openInPane({ kind: 'today' }, { from: second }))
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.id).toBe(first)
  })

  it('keeps one identity across a pane’s navigations and tab writes', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const value = result.current
    const first = value.activePane.id

    // What a navigation really does in the app: the router moves and the
    // pane’s OpenTabsProvider records the visit in settings. Neither may
    // rebuild the pane handles, or every pane’s note-move subscription
    // would be torn down and resubscribed on each keystroke-free navigation.
    await act(() => {
      value.activePane.router.navigate({ kind: 'note', path: 'notes/a.md' })
      settingsStore.update((current) => ({
        openTabs: {
          ...current.openTabs,
          [GRAPH_ROOT]: [
            {
              id: 'main',
              panes: [
                {
                  id: first,
                  tabs: [{ kind: 'note', path: 'notes/a.md', pinned: false }],
                  activeKey: 'note:notes/a.md',
                },
              ],
            },
          ],
        },
      }))
    })

    expect(result.current).toBe(value)
  })

  it('closes a pane but never the last one', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    const second = result.current.activePane.id
    await act(() => result.current.closePane(second))
    expect(result.current.panes.map((pane) => pane.id)).toEqual([first])
    await act(() => result.current.closePane(first))
    expect(result.current.panes).toHaveLength(1)
  })

  it('removes a column when its last pane closes', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    const second = result.current.activePane.id
    expect(result.current.columns).toHaveLength(2)

    await act(() => result.current.closePane(second))
    expect(result.current.columns).toHaveLength(1)
    expect(result.current.columns[0]!.panes.map((pane) => pane.id)).toEqual([first])
    expect(result.current.activePane.id).toBe(first)
  })

  it('moves a tab into a new pane below and closes an emptied source pane', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    const second = result.current.activePane.id
    // Seed what OpenTabsProvider would have written for the second pane.
    await act(() =>
      seedPaneTabs(
        second,
        [{ kind: 'note', path: 'notes/a.md', pinned: false }],
        'note:notes/a.md',
      ),
    )

    await act(() =>
      result.current.moveTab(
        { kind: 'note', path: 'notes/a.md', pinned: false },
        { from: second, to: { paneId: first, zone: 'below' } },
      ),
    )

    expect(result.current.columns).toHaveLength(1)
    expect(result.current.columns[0]!.panes).toHaveLength(2)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/a.md',
    })
    expect(result.current.panes.some((pane) => pane.id === second)).toBe(false)
    expect(storedPane(result.current.activePane.id)?.tabs).toEqual([
      { kind: 'note', path: 'notes/a.md', pinned: false },
    ])
  })

  it('moves a tab into an existing pane (center) and the source keeps its other tab', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/c.md' }, { from: first }),
    )
    const second = result.current.activePane.id
    await act(() =>
      seedPaneTabs(
        first,
        [
          { kind: 'note', path: 'notes/a.md', pinned: false },
          { kind: 'note', path: 'notes/b.md', pinned: false },
        ],
        'note:notes/a.md',
      ),
    )

    await act(() =>
      result.current.moveTab(
        { kind: 'note', path: 'notes/a.md', pinned: false },
        { from: first, to: { paneId: second, zone: 'center' } },
      ),
    )

    expect(result.current.columns).toHaveLength(2)
    expect(storedPane(first)?.tabs).toEqual([{ kind: 'note', path: 'notes/b.md', pinned: false }])
    expect(storedPane(first)?.activeKey).toBe('note:notes/b.md')
    expect(storedPane(second)?.tabs).toEqual([{ kind: 'note', path: 'notes/a.md', pinned: false }])
    expect(storedPane(second)?.activeKey).toBe('note:notes/a.md')
    expect(result.current.activePane.id).toBe(second)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/a.md',
    })
    const source = result.current.panes.find((pane) => pane.id === first)
    expect(source?.router.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/b.md' })
  })

  it('moves the active tab right into a new column', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      seedPaneTabs(
        first,
        [
          { kind: 'note', path: 'notes/a.md', pinned: false },
          { kind: 'note', path: 'notes/b.md', pinned: false },
        ],
        'note:notes/a.md',
      ),
    )

    await act(() => result.current.moveActiveTab('right'))

    expect(result.current.columns).toHaveLength(2)
    expect(storedPane(first)?.tabs).toEqual([{ kind: 'note', path: 'notes/b.md', pinned: false }])
    expect(result.current.activePane.id).not.toBe(first)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/a.md',
    })
  })

  it('moves the only tab of the only pane and leaves no trace of the old pane', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const closing = result.current.activePane
    const first = closing.id
    const revision = closing.router.navigationRevision()
    await act(() =>
      seedPaneTabs(first, [{ kind: 'note', path: 'notes/a.md', pinned: false }], 'note:notes/a.md'),
    )

    await act(() => result.current.moveActiveTab('right'))

    expect(result.current.columns).toHaveLength(1)
    expect(result.current.columns[0]!.panes).toHaveLength(1)
    // The emptied pane is gone from the document, and its router was left
    // alone: navigating it to today after the write would let its own
    // OpenTabsProvider persist the arrival and resurrect the pane.
    expect(storedPane(first)).toBeUndefined()
    expect(closing.router.navigationRevision()).toBe(revision)
    expect(result.current.activePane.id).not.toBe(first)
    expect(result.current.activePane.router.getSnapshot().route).toEqual({
      kind: 'note',
      path: 'notes/a.md',
    })
    expect(storedPane(result.current.activePane.id)?.tabs).toEqual([
      { kind: 'note', path: 'notes/a.md', pinned: false },
    ])
  })

  it('follows a note move once per pane, even under StrictMode', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper: strictWrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/x.md' }, { from: first }),
    )
    const moved = result.current.activePane
    expect(moved.id).not.toBe(first)
    const before = moved.router.navigationRevision()

    await act(() => {
      emitNoteMoved('notes/x.md', 'notes/y.md')
    })

    expect(moved.router.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/y.md' })
    // A double subscription would advance the revision twice.
    expect(moved.router.navigationRevision()).toBe(before + 1)
  })

  it('walks the active pane left and right', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    const second = result.current.activePane.id

    await act(() => result.current.focusPane('left'))
    expect(result.current.activePane.id).toBe(first)
    await act(() => result.current.focusPane('left'))
    expect(result.current.activePane.id).toBe(first)

    await act(() => result.current.focusPane('right'))
    expect(result.current.activePane.id).toBe(second)
    await act(() => result.current.focusPane('right'))
    expect(result.current.activePane.id).toBe(second)
  })

  it('focuses up and down inside a column, left and right across columns keeping the row', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const topLeft = result.current.activePane.id
    await act(() =>
      result.current.openInPane(
        { kind: 'note', path: 'notes/a.md' },
        { from: topLeft, placement: 'below' },
      ),
    )
    const bottomLeft = result.current.activePane.id
    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/b.md' }, { from: topLeft }),
    )
    const topRight = result.current.activePane.id
    await act(() =>
      result.current.openInPane(
        { kind: 'note', path: 'notes/c.md' },
        { from: topRight, placement: 'below' },
      ),
    )
    const bottomRight = result.current.activePane.id

    expect(result.current.columns.map((column) => column.panes.map((pane) => pane.id))).toEqual([
      [topLeft, bottomLeft],
      [topRight, bottomRight],
    ])
    expect(result.current.panes.map((pane) => pane.id)).toEqual([
      topLeft,
      bottomLeft,
      topRight,
      bottomRight,
    ])

    await act(() => result.current.focusPane('up'))
    expect(result.current.activePane.id).toBe(topRight)
    await act(() => result.current.focusPane('up'))
    expect(result.current.activePane.id).toBe(topRight)
    await act(() => result.current.focusPane('left'))
    expect(result.current.activePane.id).toBe(topLeft)
    await act(() => result.current.focusPane('down'))
    expect(result.current.activePane.id).toBe(bottomLeft)
    await act(() => result.current.focusPane('right'))
    expect(result.current.activePane.id).toBe(bottomRight)
    await act(() => result.current.focusPane('down'))
    expect(result.current.activePane.id).toBe(bottomRight)
  })

  it('hands window-level Find to the active pane', async () => {
    const { result, act } = await renderHook(usePanes, { wrapper })
    const first = result.current.activePane.id
    const firstActions = stubFindActions()
    const secondActions = stubFindActions()

    expect(result.current.activeFindActions()).toBeNull()
    await act(() => result.current.registerFindActions(first, firstActions))
    expect(result.current.activeFindActions()).toBe(firstActions)

    await act(() =>
      result.current.openInPane({ kind: 'note', path: 'notes/a.md' }, { from: first }),
    )
    const second = result.current.activePane.id
    await act(() => result.current.registerFindActions(second, secondActions))
    expect(result.current.activeFindActions()).toBe(secondActions)

    await act(() => result.current.registerFindActions(second, null))
    expect(result.current.activeFindActions()).toBeNull()

    await act(() => result.current.setActivePane(first))
    expect(result.current.activeFindActions()).toBe(firstActions)
  })
})
