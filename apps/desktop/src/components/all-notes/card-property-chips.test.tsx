import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { CollectionEntry, TagType } from '@reflect/core'
import { CardPropertyChips } from './card-property-chips'

vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { uiDensity: 'default', dateFormat: 'mdy', timeFormat: '12h' },
  }),
}))

const type: TagType = {
  properties: [
    { name: 'Status', key: 'status', type: 'status', options: ['Planned', 'Active', 'Done'] },
    { name: 'Due', key: 'due', type: 'date' },
    { name: 'Read', key: 'read', type: 'checkbox' },
    { name: 'Author', key: 'author', type: 'relation' },
    { name: 'Pages', key: 'pages', type: 'number' },
    { name: 'Notes', key: 'notes', type: 'text' },
  ],
}

function entryWith(properties: CollectionEntry['properties']): CollectionEntry {
  return { path: 'notes/a.md', title: 'A', mtime: 1, isPinned: false, properties }
}

describe('CardPropertyChips', () => {
  it('shows typed values as chips — badge hue for status, formatted date, checked name', async () => {
    const view = await render(
      <CardPropertyChips
        type={type}
        entry={entryWith({
          status: { value: 'Active', valueType: 'string', valueNumber: null },
          due: { value: '2026-09-06', valueType: 'string', valueNumber: null },
          read: { value: 'true', valueType: 'boolean', valueNumber: null },
          author: { value: '[[Ada Lovelace|Ada]]', valueType: 'string', valueNumber: null },
        })}
      />,
    )

    const status = view.getByText('Active').element()
    // The same deterministic wash the table badge and board dot use.
    expect(status.parentElement?.className).toContain('bg-')
    await expect.element(view.getByText('9/6/2026')).toBeInTheDocument()
    // A checked checkbox reads as its property name; the relation as its alias.
    await expect.element(view.getByText('Read')).toBeInTheDocument()
    await expect.element(view.getByText('Ada')).toBeInTheDocument()
    // The hover names what each chip is.
    await expect.element(view.getByTitle('Due: 9/6/2026')).toBeInTheDocument()
  })

  it('skips empty and unchecked values, caps at four chips, hides entirely when bare', async () => {
    const full = await render(
      <CardPropertyChips
        type={type}
        entry={entryWith({
          status: { value: 'Done', valueType: 'string', valueNumber: null },
          due: { value: '2026-01-01', valueType: 'string', valueNumber: null },
          read: { value: 'false', valueType: 'boolean', valueNumber: null },
          author: { value: 'Someone', valueType: 'string', valueNumber: null },
          pages: { value: '320', valueType: 'number', valueNumber: 320 },
          notes: { value: 'spare', valueType: 'string', valueNumber: null },
        })}
      />,
    )
    // Unchecked checkbox shows nothing; the cap lands on the first four
    // valued properties in schema order, so 'spare' never renders.
    expect(full.getByText('Read').query()).toBeNull()
    await expect.element(full.getByText('320')).toBeInTheDocument()
    expect(full.getByText('spare').query()).toBeNull()

    const bare = await render(<CardPropertyChips type={type} entry={entryWith({})} />)
    expect(bare.container.querySelector('div')).toBeNull()
  })
})
