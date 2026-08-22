import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactElement, type ReactNode } from 'react'
import type { FilteredSearchHit } from '@reflect/core'
import { RouterProvider, useRouter } from '@/routing/router'
import { EMPTY_ALL_NOTES_FILTERS } from '@/mobile/search-filters/filter-state'
import '@/test-utils/locator'
import { MobileAllNotes } from './all-notes'

/**
 * The mobile All tab's list/grid toggle: the same `allNotesView` setting as
 * desktop, cards from the search feed, tap opens the note.
 */

const searchWithFilters = vi.hoisted(() => vi.fn())
const listNoteTags = vi.hoisted(() => vi.fn())
const hapticImpactLight = vi.hoisted(() => vi.fn())
const updateSettings = vi.hoisted(() => vi.fn())
const settingsState = vi.hoisted(
  (): { allNotesView: 'list' | 'grid' } => ({
    allNotesView: 'list',
  }),
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  searchWithFilters,
  listNoteTags,
}))
vi.mock('@/mobile/haptics', () => ({ hapticImpactLight }))
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null,
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: {
      dateFormat: 'mdy',
      timeFormat: '12h',
      allNotesView: settingsState.allNotesView,
    },
    updateSettings,
  }),
}))

const HEALTH_MTIME = new Date(2020, 0, 15, 12, 0).getTime()

function hit(overrides: Partial<FilteredSearchHit> = {}): FilteredSearchHit {
  return {
    path: 'notes/health.md',
    title: 'Health Stacked',
    highlightedTitle: 'Health Stacked',
    dailyDate: null,
    snippet: null,
    preview: 'Shop your health goals.',
    mtime: HEALTH_MTIME,
    isPinned: false,
    ...overrides,
  }
}

function Harness(): ReactElement {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(EMPTY_ALL_NOTES_FILTERS)
  return (
    <MobileAllNotes
      query={query}
      onQueryChange={setQuery}
      tag={null}
      filters={filters}
      onFiltersChange={setFilters}
    />
  )
}

function RouteProbe(): ReactElement {
  const { route } = useRouter()
  return <div data-testid="route">{JSON.stringify(route)}</div>
}

async function renderScreen(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  await render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <div style={{ height: 640 }}>
          <Harness />
        </div>
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

afterEach(async () => {
  await cleanup()
})

beforeEach(() => {
  settingsState.allNotesView = 'list'
  updateSettings.mockReset()
  hapticImpactLight.mockReset()
  listNoteTags.mockResolvedValue([])
  searchWithFilters.mockResolvedValue([
    hit(),
    hit({
      path: 'notes/tokyo.md',
      title: 'Tokyo Gâteau',
      highlightedTitle: 'Tokyo Gâteau',
      preview: 'Dandelion chocolate.',
    }),
  ])
})

describe('MobileAllNotes grid view', () => {
  it('switches to the card grid through the layout toggle', async () => {
    await renderScreen()
    await expect.element(page.getByText('Health Stacked')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Grid view' }).click()
    expect(updateSettings).toHaveBeenCalledWith({ allNotesView: 'grid' })
    expect(hapticImpactLight).toHaveBeenCalledOnce()
  })

  it('renders cards with previews and opens a note on tap', async () => {
    settingsState.allNotesView = 'grid'
    await renderScreen()

    await expect.element(page.getByText('Shop your health goals.')).toBeInTheDocument()
    expect(page.getByTestId('all-notes-grid').query()).not.toBeNull()

    await page.getByRole('button', { name: 'Health Stacked' }).click()
    expect(JSON.parse(page.getByTestId('route').element().textContent ?? '{}')).toEqual({
      kind: 'note',
      path: 'notes/health.md',
    })
  })

  it('keeps free-text highlights on card titles', async () => {
    settingsState.allNotesView = 'grid'
    searchWithFilters.mockResolvedValue([
      hit({
        highlightedTitle: '\u{1}Health\u{2} Stacked',
        snippet: 'Shop your \u{1}health\u{2} goals.',
        preview: '',
      }),
    ])
    await renderScreen()

    await expect.element(page.getByTestId('all-notes-grid')).toBeInTheDocument()
    expect(
      page.getByTestId('all-notes-grid').element().querySelector('mark')?.textContent,
    ).toBe('Health')
  })
})
