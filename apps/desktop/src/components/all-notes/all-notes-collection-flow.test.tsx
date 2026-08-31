import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import { setBridge } from '@reflect/core'
import { RouterProvider } from '@/routing/router'
import { AllNotesScreen } from './all-notes-screen'

/**
 * The Collection flow end-to-end over the real query layer and a fake IPC
 * bridge (TDR 0005): the tag's type comes out of compiled `tag_types` SQL,
 * the table renders its schema columns from compiled collection SQL, and an
 * inline cell edit lands as a frontmatter write on disk (`note_read` →
 * patch → `note_write`) — the full read/write loop with no module mocked.
 */

const settingsState = vi.hoisted(
  (): { allNotesView: 'list' | 'table' | 'board'; collectionGroups: Record<string, string> } => ({
    allNotesView: 'table',
    collectionGroups: {},
  }),
)
const updateSettings = vi.hoisted(() => vi.fn())
const updateSettingsWith = vi.hoisted(() => vi.fn())

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    graph: { root: '/g', name: 'g', generation: 1 },
    indexing: false,
  }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: {
      editorMarkdownSyntax: 'hide',
      theme: 'system',
      timeFormat: '12h',
      dateFormat: 'mdy',
      allNotesFilterTags: [],
      collectionSorts: {},
      collectionGroups: settingsState.collectionGroups,
      collectionColumns: {},
      collectionViewModes: {},
      collectionSavedViews: {},
      allNotesView: settingsState.allNotesView,
      uiDensity: 'default',
    },
    updateSettings,
    updateSettingsWith,
  }),
}))

const BOOK_SCHEMA_JSON = JSON.stringify([
  { name: 'Author', key: 'author', type: 'text' },
  { name: 'Status', key: 'status', type: 'select', options: ['to-read', 'done'] },
  { name: 'Priority', key: 'priority', type: 'select', options: ['high', 'low'] },
])

const DISPOSSESSED_SOURCE = '---\nauthor: Le Guin\n---\n# The Dispossessed\n\n#book\n'

const collectionRows = [
  {
    path: 'notes/dispossessed.md',
    title: 'The Dispossessed',
    mtime: new Date(2020, 0, 15).getTime(),
    is_pinned: 0,
  },
  {
    path: 'notes/dune.md',
    title: 'Dune',
    mtime: new Date(2020, 0, 10).getTime(),
    is_pinned: 0,
  },
]
const propertyRows = [
  {
    note_path: 'notes/dispossessed.md',
    key: 'author',
    value: 'Le Guin',
    value_type: 'string',
    value_number: null,
  },
  {
    note_path: 'notes/dune.md',
    key: 'status',
    value: 'to-read',
    value_type: 'string',
    value_number: null,
  },
  {
    note_path: 'notes/dispossessed.md',
    key: 'priority',
    value: 'high',
    value_type: 'string',
    value_number: null,
  },
]

const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

setBridge({ invoke: mockInvoke, listen: async () => () => {} })

beforeEach(() => {
  settingsState.allNotesView = 'table'
  settingsState.collectionGroups = {}
  updateSettings.mockReset()
  updateSettingsWith.mockReset()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command, args) => {
    if (command === 'note_read') {
      return DISPOSSESSED_SOURCE
    }
    if (command === 'note_write') {
      return null
    }
    if (command !== 'db_query') {
      return null
    }
    const sql = String(args['sql'])
    if (sql.includes('group by')) {
      return []
    }
    if (sql.includes('tag_types')) {
      // The tag's type row — `#book` is typed in this fixture.
      return [{ tag_key: 'book', note_path: 'tags/book.md', schema_json: BOOK_SCHEMA_JSON }]
    }
    if (sql.includes('note_properties')) {
      return propertyRows
    }
    if (sql.includes('"preview"')) {
      // The classic list query (used by the list view and the bulk bar).
      return collectionRows.map((row) => ({ ...row, preview: '' }))
    }
    if (sql.includes('from "tags"')) {
      // The collection base query: notes carrying the routed tag.
      return collectionRows
    }
    return []
  })
})

function Screen(): ReactElement {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider initialRoute={{ kind: 'allNotes', tag: 'book' }}>
        <div style={{ height: '100vh' }}>
          <AllNotesScreen tag="book" />
        </div>
      </RouterProvider>
    </QueryClientProvider>
  )
}

describe('Collection flow (fake bridge, no module mocks below the hooks)', () => {
  it('offers the Collection and Board toggles, persisting the view per tag', async () => {
    settingsState.allNotesView = 'list'
    const view = await render(<Screen />)

    // The schema has a select property, so both typed views are offered; on
    // a tag route the choice lands in collectionViewModes, not the global.
    await view.getByRole('button', { name: 'Collection view' }).click()
    const tableUpdater = updateSettingsWith.mock.calls.at(-1)?.[0] as (current: {
      collectionViewModes: Record<string, string>
    }) => unknown
    expect(tableUpdater({ collectionViewModes: {} })).toEqual({
      collectionViewModes: { book: 'table' },
    })
    await view.getByRole('button', { name: 'Board view' }).click()
    const boardUpdater = updateSettingsWith.mock.calls.at(-1)?.[0] as (current: {
      collectionViewModes: Record<string, string>
    }) => unknown
    expect(boardUpdater({ collectionViewModes: {} })).toEqual({
      collectionViewModes: { book: 'board' },
    })
    expect(updateSettings).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('has one table on a typed tag: a stored list renders the collection, unoffered', async () => {
    // The global default is 'list' — on a typed tag that must land on the
    // collection table, and the switcher must not offer a second table.
    settingsState.allNotesView = 'list'
    const view = await render(<Screen />)

    await expect.element(view.getByRole('button', { name: 'Sort by Author' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'List view' }).query()).toBeNull()
    await view.unmount()
  })

  it('renders schema columns with stored values from the compiled SQL', async () => {
    const view = await render(<Screen />)

    await expect.element(view.getByRole('button', { name: 'Sort by Author' })).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Sort by Status' })).toBeInTheDocument()
    await expect.element(view.getByText('Le Guin')).toBeInTheDocument()
    await expect.element(view.getByText('to-read')).toBeInTheDocument()
    await view.unmount()
  })

  it('titles the typed tag page and opens the schema dialog from the header gear', async () => {
    const view = await render(<Screen />)

    // The routed tag is the page's own title, and — the tag being typed —
    // the schema gear sits beside it, no hover needed (no CTA either).
    await expect.element(view.getByRole('heading', { name: '#book' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Create a collection' }).query()).toBeNull()
    await view.getByRole('button', { name: 'Configure #book' }).click()

    await expect.element(page.getByText('Configure #book')).toBeInTheDocument()
    await view.unmount()
  })

  it('lands an inline cell edit as a frontmatter write on disk', async () => {
    const view = await render(<Screen />)
    await expect.element(view.getByText('Le Guin')).toBeInTheDocument()

    await view.getByText('Le Guin').click()
    const input = view.getByRole('textbox', { name: 'Author' })
    await input.fill('Ursula K. Le Guin')
    await userEvent.keyboard('{Enter}')

    // No session is open, so the commit takes the disk path: note_read of the
    // live source, a minimal-diff frontmatter patch, note_write of the result.
    await vi.waitFor(() => {
      const write = mockInvoke.mock.calls.find(([command]) => command === 'note_write')
      expect(write).toBeDefined()
      const [, writeArgs] = write!
      expect(writeArgs['path']).toBe('notes/dispossessed.md')
      expect(writeArgs['generation']).toBe(1)
      const content = String(writeArgs['contents'])
      expect(content).toContain('author: Ursula K. Le Guin')
      // The body survives the patch untouched.
      expect(content).toContain('# The Dispossessed')
      expect(content).toContain('#book')
    })
    await view.unmount()
  })

  it('regroups the board by the persisted Group-by choice', async () => {
    settingsState.allNotesView = 'board'
    settingsState.collectionGroups = { book: 'priority' }
    const view = await render(<Screen />)

    // Lanes now follow Priority: Dispossessed sits in `high`, Dune (no
    // priority) in the unset lane; the Status lanes are gone.
    const high = view.getByRole('region', { name: 'high', exact: true })
    await expect.element(high.getByRole('button', { name: 'The Dispossessed' })).toBeInTheDocument()
    const unset = view.getByRole('region', { name: 'No Priority' })
    await expect.element(unset.getByRole('button', { name: 'Dune' })).toBeInTheDocument()
    expect(view.getByRole('region', { name: 'to-read', exact: true }).query()).toBeNull()
    await view.unmount()
  })

  it('picking a Group-by property persists the per-tag choice', async () => {
    settingsState.allNotesView = 'board'
    const view = await render(<Screen />)
    await expect
      .element(view.getByRole('region', { name: 'to-read', exact: true }))
      .toBeInTheDocument()

    await view.getByRole('combobox', { name: 'Group by' }).click()
    await view.getByRole('option', { name: 'Priority' }).click()

    expect(updateSettingsWith).toHaveBeenCalled()
    const updater = updateSettingsWith.mock.calls[0]?.[0] as (current: {
      collectionGroups: Record<string, string>
    }) => { collectionGroups: Record<string, string> }
    expect(updater({ collectionGroups: {} })).toEqual({
      collectionGroups: { book: 'priority' },
    })
    await view.unmount()
  })

  it('groups the same rows into board lanes and writes a status change', async () => {
    settingsState.allNotesView = 'board'
    const view = await render(<Screen />)

    await expect
      .element(view.getByRole('region', { name: 'to-read', exact: true }))
      .toBeInTheDocument()
    await expect.element(view.getByRole('region', { name: 'No Status' })).toBeInTheDocument()

    // Dune sits in to-read; moving it is one select-editor pick.
    const lane = view.getByRole('region', { name: 'to-read', exact: true })
    await expect.element(lane.getByRole('button', { name: 'Dune' })).toBeInTheDocument()
    await lane.getByRole('button', { name: 'Edit Status' }).click()
    await view.getByRole('option', { name: 'done' }).click()

    await vi.waitFor(() => {
      const write = mockInvoke.mock.calls.find(([command]) => command === 'note_write')
      expect(write).toBeDefined()
      expect(write![1]['path']).toBe('notes/dune.md')
      expect(String(write![1]['contents'])).toContain('status: done')
    })
    await view.unmount()
  })
})
