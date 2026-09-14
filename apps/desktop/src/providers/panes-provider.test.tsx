import { useSyncExternalStore, type ReactNode } from 'react'
import { renderHook } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenPane } from '@reflect/core'
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
    openTabs: Record<string, OpenPane[]>
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

afterEach(() => {
  settingsStore.reset()
})

describe('PanesProvider', () => {
  it('starts with one pane on today', async () => {
    const { result } = await renderHook(usePanes, { wrapper })
    expect(result.current.panes).toHaveLength(1)
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
      settingsStore.update((current) => ({
        openTabs: {
          ...current.openTabs,
          [GRAPH_ROOT]: (current.openTabs[GRAPH_ROOT] ?? []).map((pane) =>
            pane.id === first
              ? {
                  ...pane,
                  tabs: [{ kind: 'surface', surface: 'daily', date: null, pinned: false }],
                  activeKey: 'surface:daily',
                }
              : pane,
          ),
        },
      })),
    )

    await act(() => result.current.setActivePane(first))
    await act(() => result.current.openInPane({ kind: 'today' }, { from: second }))
    expect(result.current.panes).toHaveLength(2)
    expect(result.current.activePane.id).toBe(first)
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
})
