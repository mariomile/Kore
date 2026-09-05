import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useSyncExternalStore, type ReactElement } from 'react'
import { setBridge, untitledNotePath, type OpenTab } from '@reflect/core'
import { SidebarOpenTabs } from '@/components/sidebar/sidebar-open-notes'
import { emitChatConversationDeleted } from '@/lib/chat-events'
import { emitNoteMoved } from '@/lib/note-moves'
import { OpenTabsProvider, useOpenTabs } from '@/providers/open-tabs-provider'
import { SidebarProvider } from '@/providers/sidebar-provider'
import { routeForPath } from '@/routing/route'
import { RouterProvider, useRouter } from '@/routing/router'
import { WorkspaceTabsStrip } from './note-tabs-strip'

/**
 * The open-tabs system end to end in the browser: the provider over a
 * stateful settings mock and the real router, with both surfaces (strip +
 * sidebar Open section) mounted together, titles resolved through the fake
 * index bridge.
 */

const settingsStore = vi.hoisted(() => {
  // Tabs are keyed by graph root (the settings document is global); the
  // mocked graph provider below serves root '/g'.
  type TabsByGraph = Record<string, OpenTab[]>
  let state: { openTabs: TabsByGraph } = { openTabs: {} }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<{ openTabs: TabsByGraph }>) {
      if (Object.keys(patch).length === 0) {
        return
      }
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset() {
      state = { openTabs: {} }
    },
  }
})

const graphStore = vi.hoisted(() => {
  let root = '/g'
  const listeners = new Set<() => void>()
  return {
    get: () => root,
    set(next: string) {
      root = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset() {
      root = '/g'
    },
  }
})

const chatStore = vi.hoisted(() => {
  let activeConversationId = 'chat-1'
  const listeners = new Set<() => void>()
  return {
    get: () => activeConversationId,
    set(next: string) {
      activeConversationId = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset() {
      activeConversationId = 'chat-1'
    },
  }
})

vi.mock('@/providers/settings-provider', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSettings: () => ({
      settings: useSyncExternalStore(
        (listener: () => void) => settingsStore.subscribe(listener),
        () => settingsStore.get(),
      ),
      updateSettings: (patch: object) => {
        settingsStore.set(patch)
      },
      updateSettingsWith: (updater: (current: object) => object) => {
        settingsStore.set(updater(settingsStore.get()))
      },
    }),
  }
})
vi.mock('@/components/command-palette/palette-provider', () => ({
  usePalette: () => ({ openPalette: vi.fn(), open: false }),
}))
vi.mock('@/providers/graph-provider', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useGraph: () => {
      const root = useSyncExternalStore(
        (listener: () => void) => graphStore.subscribe(listener),
        () => graphStore.get(),
      )
      return { graph: { root, name: root, generation: 1 }, indexing: false }
    },
  }
})
vi.mock('@/providers/chat-provider', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useOptionalChatSession: () => {
      const activeConversationId = useSyncExternalStore(
        (listener: () => void) => chatStore.subscribe(listener),
        () => chatStore.get(),
      )
      return {
        activeConversationId,
        openConversation: async (conversationId: string) => {
          chatStore.set(conversationId)
        },
      }
    },
  }
})

const TITLES: Record<string, string> = {
  'notes/alpha.md': 'Alpha Plan',
  'notes/beta.md': 'Beta Review',
  'notes/renamed.md': 'Renamed Note',
}
const UNTITLED_PATH = untitledNotePath()

setBridge({
  invoke: async (command, args) => {
    if (command !== 'db_query') {
      return null
    }
    const params = args['params'] as unknown[]
    const path = String(params[0] ?? '')
    const title = TITLES[path]
    if (title === undefined) {
      return []
    }
    return [
      {
        path,
        title,
        daily_date: null,
        is_private: 0,
        has_conflict: 0,
        gist_url: null,
        gist_stale: 0,
      },
    ]
  },
  listen: async () => () => {},
})

function Probe(): ReactElement {
  const { route, navigate } = useRouter()
  const { nextTab, previousTab, closeActiveTab, moveTab, tabs } = useOpenTabs()
  return (
    <div>
      <output data-testid="route">{JSON.stringify(route)}</output>
      <button
        type="button"
        data-testid="move-last-first"
        onClick={() => {
          const last = tabs.at(-1)
          const first = tabs[0]
          if (last !== undefined && first !== undefined) {
            moveTab(last, first)
          }
        }}
      >
        move last first
      </button>
      <button
        type="button"
        data-testid="open-alpha"
        onClick={() => navigate(routeForPath('notes/alpha.md'))}
      >
        alpha
      </button>
      <button
        type="button"
        data-testid="open-beta"
        onClick={() => navigate(routeForPath('notes/beta.md'))}
      >
        beta
      </button>
      <button
        type="button"
        data-testid="open-untitled"
        onClick={() => navigate(routeForPath(UNTITLED_PATH))}
      >
        untitled
      </button>
      <button type="button" data-testid="next-tab" onClick={nextTab}>
        next
      </button>
      <button type="button" data-testid="prev-tab" onClick={previousTab}>
        prev
      </button>
      <button type="button" data-testid="close-active" onClick={closeActiveTab}>
        close
      </button>
      <button
        type="button"
        data-testid="open-search"
        onClick={() => navigate({ kind: 'search', query: 'x' })}
      >
        search
      </button>
      <button
        type="button"
        data-testid="open-search-y"
        onClick={() => navigate({ kind: 'search', query: 'y' })}
      >
        search y
      </button>
      <button
        type="button"
        data-testid="open-all-notes"
        onClick={() => navigate({ kind: 'allNotes', tag: null })}
      >
        all notes
      </button>
      <button
        type="button"
        data-testid="open-book-tag"
        onClick={() => navigate({ kind: 'allNotes', tag: 'book' })}
      >
        book tag
      </button>
      <button type="button" data-testid="open-tasks" onClick={() => navigate({ kind: 'tasks' })}>
        tasks
      </button>
      <button
        type="button"
        data-testid="open-insights"
        onClick={() => navigate({ kind: 'insights' })}
      >
        insights
      </button>
      <button type="button" data-testid="open-graph" onClick={() => navigate({ kind: 'graphMap' })}>
        graph
      </button>
      <button type="button" data-testid="open-agents" onClick={() => navigate({ kind: 'agents' })}>
        agents
      </button>
      <button
        type="button"
        data-testid="open-settings"
        onClick={() => navigate({ kind: 'settings' })}
      >
        settings
      </button>
      <button
        type="button"
        data-testid="open-browser"
        onClick={() => navigate({ kind: 'browser' })}
      >
        browser
      </button>
      <button
        type="button"
        data-testid="open-terminal"
        onClick={() => navigate({ kind: 'terminal' })}
      >
        terminal
      </button>
      <button
        type="button"
        data-testid="open-chat-one"
        onClick={() => {
          chatStore.set('chat-1')
          navigate({ kind: 'chat' })
        }}
      >
        chat one
      </button>
      <button
        type="button"
        data-testid="open-chat-two"
        onClick={() => {
          chatStore.set('chat-2')
          navigate({ kind: 'chat' })
        }}
      >
        chat two
      </button>
      <button type="button" data-testid="switch-graph" onClick={() => graphStore.set('/other')}>
        graph workspace
      </button>
    </div>
  )
}

function renderTabs() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GraphHarness />
    </QueryClientProvider>,
  )
}

function GraphHarness(): ReactElement {
  const root = useSyncExternalStore(
    (listener: () => void) => graphStore.subscribe(listener),
    () => graphStore.get(),
  )
  return (
    <RouterProvider key={root} initialRoute={{ kind: 'today' }}>
      <SidebarProvider>
        <OpenTabsProvider>
          <WorkspaceTabsStrip />
          <SidebarOpenTabs />
          <Probe />
        </OpenTabsProvider>
      </SidebarProvider>
    </RouterProvider>
  )
}

function routeOf(view: Awaited<ReturnType<typeof renderTabs>>): {
  kind: string
  path?: string
  query?: string
  tag?: string | null
} {
  return JSON.parse(view.getByTestId('route').element().textContent ?? '{}') as {
    kind: string
    path?: string
    query?: string
    tag?: string | null
  }
}

beforeEach(() => {
  settingsStore.reset()
  graphStore.reset()
  chatStore.reset()
})

describe('workspace tabs', () => {
  it('always shows the bar, and an opened note joins both surfaces', async () => {
    const view = await renderTabs()
    // The bar is the title bar now: always present, Daily pill leading.
    await expect.element(view.getByRole('tab', { name: 'Daily notes' })).toBeVisible()

    await view.getByTestId('open-alpha').click()
    await expect.element(view.getByRole('tab', { name: /Alpha Plan/ })).toBeVisible()
    // The sidebar Open section lists it too, and the Daily tab leads.
    await expect.element(view.getByText('Open')).toBeVisible()
    await expect.element(view.getByRole('tab', { name: 'Daily notes' })).toBeVisible()
    await view.unmount()
  })

  it('switches notes through tabs and closes onto the neighbor', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-beta').click()
    await expect.element(view.getByRole('tab', { name: /Beta Review/ })).toBeVisible()

    // Click the Alpha tab: the route follows.
    await view
      .getByRole('tab', { name: /Alpha Plan/ })
      .getByText('Alpha Plan')
      .click()
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/alpha.md'))

    // Close the active tab: lands on the neighbor (Beta), tab gone everywhere.
    await view.getByTestId('close-active').click()
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/beta.md'))
    expect(view.getByRole('tab', { name: /Alpha Plan/ }).query()).toBeNull()

    // Close the last one: back to Daily; only the Daily pill remains.
    await view.getByTestId('close-active').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    expect(view.getByRole('tab', { name: /Beta Review/ }).query()).toBeNull()
    await view.unmount()
  })

  it('the list menu names every open tab and jumps on click', async () => {
    const view = await renderTabs()
    // A single tab hides the menu — nothing worth listing.
    expect(view.container.querySelector('[aria-label="List open tabs"]')).toBeNull()

    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-beta').click()
    await view.getByRole('button', { name: 'List open tabs' }).click()
    await expect.element(view.getByRole('menuitem', { name: /Alpha Plan/ })).toBeVisible()
    await view.getByRole('menuitem', { name: /Alpha Plan/ }).click()
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/alpha.md'))
    await view.unmount()
  })

  it('moveTab drops the dragged tab at its target and the order persists', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-beta').click()
    await expect.element(view.getByRole('tab', { name: /Beta Review/ })).toBeVisible()

    // Strip order starts Daily · Alpha · Beta; dropping the last tab on the
    // first (what a drag to the front resolves to) leads with Beta.
    await view.getByTestId('move-last-first').click()
    await vi.waitFor(() => {
      const first = view.getByRole('tablist').element().querySelector('[role="tab"]')
      expect(first?.textContent ?? '').toContain('Beta Review')
    })
    // The reorder is the persisted strip order, not a render artifact.
    const stored = settingsStore.get().openTabs['/g'] ?? []
    expect(stored[0]).toMatchObject({ kind: 'note', path: 'notes/beta.md' })
    await view.unmount()
  })

  it('cycles Daily → tabs → Daily with next and previous', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-beta').click()

    // From Beta, next wraps to Daily; next again enters Alpha.
    await view.getByTestId('next-tab').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    await view.getByTestId('next-tab').click()
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/alpha.md'))
    await view.getByTestId('prev-tab').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    await view.unmount()
  })

  it('the rail toggles report and flip their pressed state', async () => {
    const view = await renderTabs()
    const left = view.getByRole('button', { name: 'Toggle sidebar' })
    const right = view.getByRole('button', { name: 'Toggle context panel' })
    // Pressed = the rail is shown; both start expanded.
    await expect.element(left).toHaveAttribute('aria-pressed', 'true')
    await expect.element(right).toHaveAttribute('aria-pressed', 'true')

    await left.click()
    await expect.element(left).toHaveAttribute('aria-pressed', 'false')
    await expect.element(right).toHaveAttribute('aria-pressed', 'true')

    await right.click()
    await expect.element(right).toHaveAttribute('aria-pressed', 'false')
    await left.click()
    await expect.element(left).toHaveAttribute('aria-pressed', 'true')
    await view.unmount()
  })

  it('tabs singleton routes and cycles from Search back to Daily', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-search').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('search'))
    await expect.element(view.getByRole('tab', { name: 'Search' })).toBeVisible()

    await view.getByTestId('open-search-y').click()
    await vi.waitFor(() => expect(routeOf(view).query).toBe('y'))
    expect(
      [...view.getByRole('tablist').element().querySelectorAll('[role="tab"]')].filter(
        (tab) => tab.textContent === 'Search',
      ),
    ).toHaveLength(1)

    await view.getByTestId('next-tab').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    await view.unmount()
  })

  it('pins a tab to an icon leading the strip via double click', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-beta').click()

    const betaLabel = view.getByRole('tab', { name: /Beta Review/ }).getByText('Beta Review')
    await userEvent.dblClick(betaLabel)
    // Pinned: icon-only tab, labeled by the title, ordered before Alpha.
    const pinned = view.getByRole('tab', { name: 'Beta Review' })
    await expect.element(pinned).toBeVisible()
    const tabs = view.getByRole('tablist').element()
    const labels = [...tabs.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.getAttribute('aria-label') ?? tab.textContent,
    )
    expect(labels[0]).toBe('Beta Review')
    expect(labels[1]).toContain('Daily notes')
    await view.unmount()
  })

  it('history arrows walk the router stack and disable at its edges', async () => {
    const view = await renderTabs()
    const backButton = view.getByRole('button', { name: 'Go back' })
    const forwardButton = view.getByRole('button', { name: 'Go forward' })
    await expect.element(backButton).toBeDisabled()
    await expect.element(forwardButton).toBeDisabled()

    await view.getByTestId('open-alpha').click()
    await expect.element(backButton).toBeEnabled()
    await backButton.click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    await expect.element(forwardButton).toBeEnabled()
    await forwardButton.click()
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/alpha.md'))
    await view.unmount()
  })

  it('closes a sidebar row without leaving the current note', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-alpha').click()
    await view.getByTestId('open-beta').click()

    // Close Alpha (inactive) from the sidebar: route stays on Beta.
    await view.getByRole('button', { name: 'Close Alpha Plan' }).first().click()
    await vi.waitFor(() => expect(view.getByRole('tab', { name: /Alpha Plan/ }).query()).toBeNull())
    expect(routeOf(view).path).toBe('notes/beta.md')
    await view.unmount()
  })

  it('opening settings does not add a tab; browser still does', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-settings').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('settings'))
    expect(view.getByRole('tab', { name: /Settings/ }).query()).toBeNull()

    await view.getByTestId('open-browser').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('browser'))
    await expect.element(view.getByRole('tab', { name: /Browser/ })).toBeVisible()

    await view.getByRole('button', { name: 'Close Browser' }).first().click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    expect(view.getByRole('tab', { name: /Browser/ }).query()).toBeNull()
    await view.unmount()
  })

  it('opens untitled notes immediately and follows their birth rename', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-untitled').click()
    await expect.element(view.getByRole('tab', { name: 'Untitled' })).toBeVisible()

    emitNoteMoved(UNTITLED_PATH, 'notes/renamed.md')
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/renamed.md'))
    await expect.element(view.getByRole('tab', { name: /Renamed Note/ })).toBeVisible()
    expect(view.getByRole('tab', { name: 'Untitled' }).query()).toBeNull()
    await view.unmount()
  })

  it('opens every workspace surface as a deduplicated tab', async () => {
    const view = await renderTabs()
    const surfaces = [
      ['open-all-notes', 'All notes'],
      ['open-tasks', 'Tasks'],
      ['open-insights', 'Insights'],
      ['open-graph', 'Graph'],
      ['open-agents', 'Agents'],
      ['open-terminal', 'Terminal'],
      ['open-browser', 'Browser'],
    ] as const

    for (const [testId, label] of surfaces) {
      await view.getByTestId(testId).click()
      await expect.element(view.getByRole('tab', { name: label })).toBeVisible()
    }
    await view.getByTestId('open-tasks').click()
    expect(
      [...view.getByRole('tablist').element().querySelectorAll('[role="tab"]')].filter(
        (tab) => tab.textContent === 'Tasks',
      ),
    ).toHaveLength(1)
    await view.unmount()
  })

  it('names the All Notes tab after its routed tag', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-all-notes').click()
    await expect.element(view.getByRole('tab', { name: 'All notes' })).toBeVisible()

    // A routed tag is that tag's own page, and the one surface tab renames —
    // it does not spawn a second tab beside the generic label.
    await view.getByTestId('open-book-tag').click()
    await expect.element(view.getByRole('tab', { name: '#book' })).toBeVisible()
    expect(view.getByRole('tab', { name: 'All notes' }).query()).toBeNull()

    await view.getByTestId('open-all-notes').click()
    await expect.element(view.getByRole('tab', { name: 'All notes' })).toBeVisible()
    expect(view.getByRole('tab', { name: '#book' }).query()).toBeNull()
    await view.unmount()
  })

  it('keeps separate chat tabs, activates existing conversations, and closes deleted chats', async () => {
    const view = await renderTabs()
    await view.getByTestId('open-chat-one').click()
    await view.getByTestId('open-chat-two').click()
    await vi.waitFor(() => {
      const labels = [...view.getByRole('tablist').element().querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      )
      expect(labels.filter((label) => label === 'New chat')).toHaveLength(2)
    })

    const chatTabs = view.getByRole('tab', { name: 'New chat' })
    await chatTabs.first().getByText('New chat').click()
    await vi.waitFor(() => expect(chatStore.get()).toBe('chat-1'))

    emitChatConversationDeleted('chat-1')
    await vi.waitFor(() => {
      const labels = [...view.getByRole('tablist').element().querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      )
      expect(labels.filter((label) => label === 'New chat')).toHaveLength(1)
    })
    await view.unmount()
  })

  it('makes Daily closable and restores it only as the last-tab fallback', async () => {
    const view = await renderTabs()
    await expect.element(view.getByRole('tab', { name: 'Daily notes' })).toBeVisible()
    await view.getByTestId('close-active').click()
    await expect.element(view.getByRole('tab', { name: 'Daily notes' })).toBeVisible()

    await view.getByTestId('open-alpha').click()
    await view.getByRole('tab', { name: 'Daily notes' }).getByText('Daily notes').click()
    await view.getByTestId('close-active').click()
    await vi.waitFor(() => expect(routeOf(view).path).toBe('notes/alpha.md'))
    expect(view.getByRole('tab', { name: 'Daily notes' }).query()).toBeNull()

    await view.getByTestId('close-active').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    await expect.element(view.getByRole('tab', { name: 'Daily notes' })).toBeVisible()
    await view.unmount()
  })

  it('restores persisted tabs and isolates them by graph', async () => {
    settingsStore.set({
      openTabs: {
        '/g': [
          { kind: 'surface', surface: 'daily', date: null, pinned: false },
          { kind: 'note', path: 'notes/alpha.md', pinned: false },
        ],
      },
    })
    const view = await renderTabs()
    await expect.element(view.getByRole('tab', { name: /Alpha Plan/ })).toBeVisible()

    await view.getByTestId('switch-graph').click()
    await vi.waitFor(() => expect(routeOf(view).kind).toBe('today'))
    expect(view.getByRole('tab', { name: /Alpha Plan/ }).query()).toBeNull()
    await expect.element(view.getByRole('tab', { name: 'Daily notes' })).toBeVisible()
    await view.unmount()
  })
})
