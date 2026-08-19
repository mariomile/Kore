import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import { setBridge } from '@reflect/core'
import { SidebarOpenNotes } from '@/components/sidebar/sidebar-open-notes'
import { OpenTabsProvider, useOpenTabs } from '@/providers/open-tabs-provider'
import { routeForPath } from '@/routing/route'
import { RouterProvider, useRouter } from '@/routing/router'
import { NoteTabsStrip } from './note-tabs-strip'

/**
 * The open-tabs system end to end in the browser: the provider over a
 * stateful settings mock and the real router, with both surfaces (strip +
 * sidebar Open section) mounted together, titles resolved through the fake
 * index bridge.
 */

const settingsStore = vi.hoisted(() => {
  type Tabs = { path: string; pinned: boolean }[]
  let state: { openNoteTabs: Tabs } = { openNoteTabs: [] }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<{ openNoteTabs: Tabs }>) {
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
      state = { openNoteTabs: [] }
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
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 }, indexing: false }),
}))

const TITLES: Record<string, string> = {
  'notes/alpha.md': 'Alpha Plan',
  'notes/beta.md': 'Beta Review',
}

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
  const { nextTab, previousTab, closeActiveTab } = useOpenTabs()
  return (
    <div>
      <output data-testid="route">{JSON.stringify(route)}</output>
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
      <button type="button" data-testid="next-tab" onClick={nextTab}>
        next
      </button>
      <button type="button" data-testid="prev-tab" onClick={previousTab}>
        prev
      </button>
      <button type="button" data-testid="close-active" onClick={closeActiveTab}>
        close
      </button>
    </div>
  )
}

function renderTabs() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'today' }}>
        <OpenTabsProvider>
          <NoteTabsStrip />
          <SidebarOpenNotes />
          <Probe />
        </OpenTabsProvider>
      </RouterProvider>
    </QueryClientProvider>,
  )
}

function routeOf(view: Awaited<ReturnType<typeof renderTabs>>): { kind: string; path?: string } {
  return JSON.parse(view.getByTestId('route').element().textContent ?? '{}') as {
    kind: string
    path?: string
  }
}

beforeEach(() => {
  settingsStore.reset()
})

describe('note tabs', () => {
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
    expect(labels[0]).toContain('Daily notes')
    expect(labels[1]).toBe('Beta Review')
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
})
