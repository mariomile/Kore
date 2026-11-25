import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactElement, type ReactNode } from 'react'
import type { AllNotesSort, FilteredSearchHit } from '@kore/core'
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
const firstImageAssets = vi.hoisted(() => vi.fn())
const readNote = vi.hoisted(() => vi.fn())
const haptic = vi.hoisted(() => vi.fn())
const updateSettings = vi.hoisted(() => vi.fn())
// Lets a test re-render the screen after mutating `settingsState`, the way
// the real provider does after `updateSettings`.
const settingsListeners = vi.hoisted(() => new Set<() => void>())
function notifySettings(): void {
  for (const listener of settingsListeners) listener()
}
const settingsState = vi.hoisted(
  (): { allNotesView: 'list' | 'grid'; allNotesSort: AllNotesSort } => ({
    allNotesView: 'list',
    allNotesSort: 'updated-desc',
  }),
)

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  searchWithFilters,
  listNoteTags,
  firstImageAssets,
  readNote,
  assetUrl: (_generation: number, path: string) => `kore-asset://localhost/${path}`,
}))
vi.mock('@/lib/haptics', () => ({ haptic }))
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
vi.mock('@/providers/settings-provider', async () => {
  const { useSyncExternalStore } = await import('react')
  let version = 0
  const subscribe = (listener: () => void) => {
    const bump = () => {
      version += 1
      listener()
    }
    settingsListeners.add(bump)
    return () => settingsListeners.delete(bump)
  }
  return {
    useSettings: () => {
      useSyncExternalStore(subscribe, () => version)
      return {
        settings: {
          dateFormat: 'mdy',
          timeFormat: '12h',
          allNotesView: settingsState.allNotesView,
          allNotesSort: settingsState.allNotesSort,
        },
        updateSettings,
      }
    },
  }
})

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
  settingsState.allNotesSort = 'updated-desc'
  updateSettings.mockReset()
  haptic.mockReset()
  listNoteTags.mockResolvedValue([])
  firstImageAssets.mockResolvedValue(new Map())
  // No note body unless a test provides one: the card keeps its snippet.
  readNote.mockReset()
  readNote.mockRejectedValue(new Error('unread'))
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
  it('shows a retry action when the note query fails', async () => {
    searchWithFilters.mockRejectedValueOnce(new Error('index unavailable'))
    await renderScreen()

    await expect.element(page.getByText('Couldn’t load your notes.')).toBeVisible()
    searchWithFilters.mockResolvedValueOnce([hit()])
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByText('Health Stacked')).toBeVisible()
  })

  it('switches to the card grid through the layout toggle', async () => {
    await renderScreen()
    await expect.element(page.getByText('Health Stacked')).toBeInTheDocument()

    const layout = page.getByRole('group', { name: 'Layout' }).element()
    const indicator = layout.querySelector<HTMLElement>('[data-sliding-indicator]')
    expect(indicator).not.toBeNull()
    expect(indicator?.style.transform).not.toBe('')
    expect(indicator?.classList.contains('motion-reduce:transition-none')).toBe(true)

    await page.getByRole('button', { name: 'Grid view' }).click()
    expect(updateSettings).toHaveBeenCalledWith({ allNotesView: 'grid' })
    expect(haptic).toHaveBeenCalledOnce()
  })

  it('renders cards with previews and opens a note on tap', async () => {
    settingsState.allNotesView = 'grid'
    await renderScreen()

    await expect.element(page.getByText('Shop your health goals.')).toBeInTheDocument()
    expect(page.getByTestId('all-notes-grid').query()).not.toBeNull()
    expect(
      page
        .getByRole('button', { name: 'Health Stacked' })
        .element()
        .classList.contains('shadow-sm'),
    ).toBe(false)

    await page.getByRole('button', { name: 'Health Stacked' }).click()
    expect(JSON.parse(page.getByTestId('route').element().textContent ?? '{}')).toEqual({
      kind: 'note',
      path: 'notes/health.md',
    })
  })

  it("tops a card with the note's first image", async () => {
    settingsState.allNotesView = 'grid'
    firstImageAssets.mockResolvedValue(new Map([['notes/health.md', 'assets/face.jpg']]))
    await renderScreen()

    // A decorative thumbnail (alt=""), so it has no img role to query by.
    const card = (path: string): Element | null =>
      page
        .getByTestId('all-notes-grid')
        .element()
        .querySelector(`[data-note-path="${CSS.escape(path)}"]`)
    await expect.poll(() => card('notes/health.md')?.querySelector('img')).not.toBeNull()
    expect(card('notes/health.md')?.querySelector('img')?.getAttribute('src')).toContain('face.jpg')
    expect(card('notes/tokyo.md')).not.toBeNull()
    expect(card('notes/tokyo.md')?.querySelector('img')).toBeNull()
  })

  it('shows the note itself once scrolling rests: a table as a table, a tag as a chip', async () => {
    settingsState.allNotesView = 'grid'
    searchWithFilters.mockResolvedValue([hit({ preview: 'Industry: Robotics' })])
    readNote.mockResolvedValue(
      '# Health Stacked\n\nType: #company\n\n| Campo | Valore |\n| --- | --- |\n| Industry | Robotics |\n',
    )
    await renderScreen()

    const grid = page.getByTestId('all-notes-grid')
    await expect.poll(() => grid.element().querySelector('table')).not.toBeNull()
    expect(grid.element().querySelectorAll('td')).toHaveLength(2)
    expect(grid.element().textContent).toContain('#company')
  })

  it('makes a card as tall as its note, then holds that height', async () => {
    settingsState.allNotesView = 'grid'
    // Its own version of the note: heights are remembered per version.
    searchWithFilters.mockResolvedValue([
      hit({ preview: 'Industry: Robotics', mtime: HEALTH_MTIME + 1 }),
    ])
    readNote.mockResolvedValue(
      '# Health Stacked\n\n| Campo | Valore |\n| --- | --- |\n| Industry | Robotics |\n| Stage | Seed |\n',
    )
    await renderScreen()

    await expect.element(page.getByTestId('all-notes-grid')).toBeInTheDocument()
    const grid = page.getByTestId('all-notes-grid').element()
    await expect.poll(() => grid.querySelector('table')).not.toBeNull()
    const preview = grid.querySelector<HTMLElement>('.kore-hover-preview')
    const slot = preview?.parentElement
    await expect.poll(() => slot?.style.height).toMatch(/px$/)
    // Shown once its height is kept.
    expect(grid.querySelector('[data-preview-pending]')).toBeNull()
    // The whole table fits: nothing is cut, nothing is left empty.
    expect(preview?.scrollHeight).toBeLessThanOrEqual((preview?.clientHeight ?? 0) + 1)
    expect(slot?.getBoundingClientRect().height).toBeCloseTo(
      preview?.getBoundingClientRect().height ?? 0,
      0,
    )
  })

  it('shows the grid with the snippets when the notes cannot be read', async () => {
    settingsState.allNotesView = 'grid'
    searchWithFilters.mockResolvedValue([hit({ preview: 'Industry: Robotics' })])
    await renderScreen()

    await expect.element(page.getByTestId('all-notes-grid')).toBeInTheDocument()
    const grid = page.getByTestId('all-notes-grid').element()
    await expect.poll(() => grid.querySelector('[data-preview-pending]')).toBeNull()
    expect(grid.textContent).toContain('Industry: Robotics')
  })

  it('aligns the first card in each masonry column to the same top edge', async () => {
    settingsState.allNotesView = 'grid'
    searchWithFilters.mockResolvedValue([
      hit({
        preview:
          'A deliberately long preview that wraps across several lines and makes this card much taller than its neighbor.',
      }),
      hit({
        path: 'notes/short.md',
        title: 'Short note',
        highlightedTitle: 'Short note',
        preview: '',
      }),
    ])
    await renderScreen()

    await expect.element(page.getByTestId('all-notes-grid')).toBeInTheDocument()
    const cards = page.getByTestId('all-notes-grid').element().querySelectorAll('button')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.getBoundingClientRect().top).toBe(cards[1]?.getBoundingClientRect().top)
  })

  it('reads row by row in the list order, newest top left then top right', async () => {
    settingsState.allNotesView = 'grid'
    searchWithFilters.mockResolvedValue(
      ['One', 'Two', 'Three', 'Four'].map((title, index) =>
        hit({
          path: `notes/${title}.md`,
          title,
          highlightedTitle: title,
          mtime: HEALTH_MTIME - index * 60_000,
        }),
      ),
    )
    await renderScreen()

    await expect.element(page.getByRole('button', { name: 'Four' })).toBeInTheDocument()
    const box = (name: string): DOMRect =>
      page.getByRole('button', { name }).element().getBoundingClientRect()
    // Second newest sits beside the newest, not at the bottom of the left column.
    expect(box('Two').top).toBe(box('One').top)
    expect(box('Two').left).toBeGreaterThan(box('One').left)
    expect(box('Three').left).toBe(box('One').left)
    expect(box('Four').left).toBe(box('Two').left)
    expect(box('Three').top).toBeGreaterThan(box('One').top)
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
    expect(page.getByTestId('all-notes-grid').element().querySelector('mark')?.textContent).toBe(
      'Health',
    )
  })
})

describe('MobileAllNotes sort', () => {
  // Each row's swipe action names its note ("Pin Banana" / "Unpin Zebra").
  const titlesInOrder = (): string[] =>
    [...document.querySelectorAll('button[aria-label^="Pin "], button[aria-label^="Unpin "]')].map(
      (button) => (button.getAttribute('aria-label') ?? '').replace(/^(?:Un)?[Pp]in /, ''),
    )

  beforeEach(() => {
    // The index's own order: pinned first, then newest.
    searchWithFilters.mockResolvedValue([
      hit({ path: 'notes/pinned.md', title: 'Zebra', highlightedTitle: 'Zebra', isPinned: true }),
      hit({ path: 'notes/b.md', title: 'Banana', highlightedTitle: 'Banana', mtime: 300 }),
      hit({ path: 'notes/a.md', title: 'apple', highlightedTitle: 'apple', mtime: 200 }),
      hit({ path: 'notes/c.md', title: 'Cherry', highlightedTitle: 'Cherry', mtime: 100 }),
    ])
  })

  it('keeps the index order for the default sort', async () => {
    await renderScreen()
    await expect.element(page.getByText('Cherry')).toBeInTheDocument()
    expect(titlesInOrder()).toEqual(['Zebra', 'Banana', 'apple', 'Cherry'])
  })

  it('orders the feed by the persisted sort, pinned notes still first', async () => {
    settingsState.allNotesSort = 'title-asc'
    await renderScreen()
    await expect.element(page.getByText('Cherry')).toBeInTheDocument()
    expect(titlesInOrder()).toEqual(['Zebra', 'apple', 'Banana', 'Cherry'])
    await expect
      .element(page.getByRole('button', { name: 'Sort', exact: true }))
      .toHaveAccessibleDescription('Title, A to Z')
  })

  it('keeps relevance order while free text is searched', async () => {
    settingsState.allNotesSort = 'title-asc'
    await renderScreen()
    await page.getByRole('searchbox', { name: 'Search notes' }).fill('fruit')
    await expect
      .poll(() =>
        searchWithFilters.mock.calls.some(
          ([parsed]) => (parsed as { text: string }).text === 'fruit',
        ),
      )
      .toBe(true)
    // The sorted placeholder holds until the ranked rows land in index order.
    await expect.poll(titlesInOrder).toEqual(['Zebra', 'Banana', 'apple', 'Cherry'])
  })

  it('keeps the sorted feed while a typed search is still loading', async () => {
    settingsState.allNotesSort = 'title-asc'
    await renderScreen()
    await expect.element(page.getByText('Cherry')).toBeInTheDocument()
    // The ranked query never settles, so the previous (sorted) rows stay up.
    searchWithFilters.mockImplementation(() => new Promise<FilteredSearchHit[]>(() => {}))
    await page.getByRole('searchbox', { name: 'Search notes' }).fill('fruit')
    await expect
      .poll(() =>
        searchWithFilters.mock.calls.some(
          ([parsed]) => (parsed as { text: string }).text === 'fruit',
        ),
      )
      .toBe(true)
    expect(titlesInOrder()).toEqual(['Zebra', 'apple', 'Banana', 'Cherry'])
  })

  it('reorders in memory on a sort change, without asking the index again', async () => {
    updateSettings.mockImplementation((patch: { allNotesSort?: AllNotesSort }) => {
      Object.assign(settingsState, patch)
      notifySettings()
    })
    await renderScreen()
    await expect.element(page.getByText('Cherry')).toBeInTheDocument()
    const calls = searchWithFilters.mock.calls.length
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await page.getByRole('button', { name: 'Title' }).click()
    await expect.poll(titlesInOrder).toEqual(['Zebra', 'apple', 'Banana', 'Cherry'])
    expect(searchWithFilters.mock.calls.length).toBe(calls)
  })

  it('writes the sheet’s choice to the shared setting', async () => {
    await renderScreen()
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await page.getByRole('button', { name: 'Title' }).click()
    expect(updateSettings).toHaveBeenCalledWith({ allNotesSort: 'title-asc' })
  })
})
