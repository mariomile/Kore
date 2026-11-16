import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type {
  CollectionEmbed,
  CollectionEntry,
  CollectionValue,
  TagProperty,
  TagType,
} from '@kore/core'
import { EMBED_PREVIEW_ROWS, MobileCollectionEmbed } from './mobile-collection-embed'

vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: () => {} }))
vi.mock('@/mobile/note-card-grid', () => ({ useFirstImages: () => new Map() }))
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => () => {},
  useCommitNoteProperties: () => () => {},
}))
vi.mock('@/lib/tags/use-open-relation', () => ({ useOpenRelation: () => () => {} }))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: {
      uiDensity: 'default',
      dateFormat: 'mdy',
      timeFormat: '12h',
      weekStartDay: 'monday',
    },
  }),
}))

const STATUS: TagProperty = {
  name: 'Status',
  key: 'status',
  type: 'select',
  options: ['Idea', 'Doing', 'Done'],
}
const DUE: TagProperty = { name: 'Due', key: 'due', type: 'date' }
const PROJECT: TagType = { properties: [STATUS, DUE] }

function text(value: string): CollectionValue {
  return { value, valueType: 'string', valueNumber: null }
}

function entry(path: string, title: string, properties: Record<string, CollectionValue>) {
  return { path, title, mtime: 0, isPinned: false, properties } as CollectionEntry
}

const ENTRIES = [
  entry('notes/kitchen.md', 'Kitchen shelves', { status: text('Idea') }),
  entry('notes/launch.md', 'V2 launch plan', { status: text('Doing'), due: text('2099-01-13') }),
]

function fence(overrides: Partial<CollectionEmbed> = {}): CollectionEmbed {
  return {
    selection: { kind: 'tag', tag: 'project' },
    view: 'table',
    sorts: [],
    group: null,
    filters: [],
    match: 'all',
    ...overrides,
  }
}

async function mount(
  embed: CollectionEmbed,
  options: { entries?: readonly CollectionEntry[]; onOpenAll?: () => void } = {},
) {
  const onChange = vi.fn()
  const onOpen = vi.fn()
  const entries = options.entries ?? ENTRIES
  const view = await render(
    <MobileCollectionEmbed
      embed={embed}
      onChange={onChange}
      onRemove={() => {}}
      title="Project"
      entries={entries}
      unfiltered={entries}
      type={PROJECT}
      groupProperties={[STATUS]}
      boardProperties={[STATUS]}
      dateProperty={DUE}
      onOpen={onOpen}
      onOpenAll={options.onOpenAll}
    />,
  )
  return { view, onChange, onOpen }
}

describe('MobileCollectionEmbed', () => {
  it('shows the collection name, its count and the table', async () => {
    const { view } = await mount(fence())
    const card = view.getByRole('region', { name: 'Collection Project' })
    await expect.element(card.getByText('2', { exact: true }).first()).toBeVisible()
    await expect.element(card.getByRole('table', { name: 'Project' })).toBeVisible()
    await expect
      .element(card.getByRole('button', { name: 'Table view' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('switches layout by rewriting the fence', async () => {
    const { view, onChange } = await mount(fence())
    await userEvent.click(view.getByRole('button', { name: 'Board view' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'board', group: 'status' }),
    )
  })

  it('lays the board out as lanes by the fence group', async () => {
    const { view, onOpen } = await mount(fence({ view: 'board', group: 'status' }))
    await expect.element(view.getByRole('region', { name: 'Idea, 1' })).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: /V2 launch plan/ }))
    expect(onOpen).toHaveBeenCalledWith('notes/launch.md')
  })

  it('reads the calendar as the next dated notes', async () => {
    const { view } = await mount(fence({ view: 'calendar' }))
    await expect.element(view.getByRole('button', { name: /V2 launch plan/ })).toBeVisible()
    expect(view.getByRole('button', { name: /Kitchen shelves/ }).query()).toBeNull()
  })

  it('previews a few rows and opens the rest on the type page', async () => {
    const many = Array.from({ length: EMBED_PREVIEW_ROWS + 3 }, (_, index) =>
      entry(`notes/n${index}.md`, `Note ${index}`, { status: text('Idea') }),
    )
    const onOpenAll = vi.fn()
    const { view } = await mount(fence(), { entries: many, onOpenAll })
    await expect.element(view.getByRole('rowheader', { name: 'Note 0' })).toBeVisible()
    expect(view.getByRole('rowheader', { name: `Note ${EMBED_PREVIEW_ROWS}` }).query()).toBeNull()
    await userEvent.click(view.getByRole('button', { name: `Show all ${many.length}` }))
    expect(onOpenAll).toHaveBeenCalled()
  })

  it('hides a field in the fence from the options sheet', async () => {
    const { view, onChange } = await mount(fence())
    await userEvent.click(view.getByRole('button', { name: 'View options' }))
    await expect
      .element(view.getByText('Saved in this note, so the Mac shows the same view.'))
      .toBeVisible()
    await userEvent.click(view.getByRole('button', { name: /^Fields/ }))
    await userEvent.click(view.getByRole('switch', { name: 'Due' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hidden: ['due'] }))
  })

  it('drops the hidden key once every field shows again', async () => {
    const { view, onChange } = await mount(fence({ hidden: ['due'] }))
    await userEvent.click(view.getByRole('button', { name: 'View options' }))
    await userEvent.click(view.getByRole('button', { name: /^Fields/ }))
    await userEvent.click(view.getByRole('switch', { name: 'Due' }))
    const written = onChange.mock.calls.at(-1)?.[0] as CollectionEmbed
    expect(written).not.toHaveProperty('hidden')
  })
})
