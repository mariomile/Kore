import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useState } from 'react'
import type {
  CollectionEntry,
  CollectionSort,
  CollectionValue,
  TagProperty,
  TagType,
} from '@kore/core'
import type {
  CollectionFilter,
  CollectionFilterMatch,
} from '@/components/all-notes/collection-filter-menu'
import { MobileViewOptions } from './mobile-view-options'

vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { uiDensity: 'default', dateFormat: 'mdy', timeFormat: '12h' },
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

const ENTRIES = [
  {
    path: 'notes/a.md',
    title: 'A',
    mtime: 0,
    isPinned: false,
    properties: { status: text('Idea') },
  },
] as CollectionEntry[]

function Harness({
  onFilters,
  onSorts,
  onGroup,
  onToggleField,
  onFreeze,
}: {
  onFilters: (filters: CollectionFilter[]) => void
  onSorts: (sorts: readonly CollectionSort[]) => void
  onGroup: (key: string | null) => void
  onToggleField: (key: string) => void
  onFreeze: (count: number) => void
}) {
  const [filters, setFilters] = useState<CollectionFilter[]>([])
  const [match, setMatch] = useState<CollectionFilterMatch>('all')
  const [sorts, setSorts] = useState<readonly CollectionSort[]>([])
  const [group, setGroup] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [frozen, setFrozen] = useState(0)
  return (
    <MobileViewOptions
      open
      onOpenChange={() => {}}
      viewName="Table"
      layout="table"
      type={PROJECT}
      entries={ENTRIES}
      filters={filters}
      onFiltersChange={(next) => {
        setFilters(next)
        onFilters(next)
      }}
      match={match}
      onMatchChange={setMatch}
      sorts={sorts}
      onSortsChange={(next) => {
        setSorts(next)
        onSorts(next)
      }}
      grouping={{
        properties: [STATUS],
        selected: group === null ? null : STATUS,
        allowNone: true,
        onChange: (key) => {
          setGroup(key)
          onGroup(key)
        },
      }}
      hiddenFields={hidden}
      onToggleField={(key) => {
        setHidden((current) => {
          const next = new Set(current)
          if (next.has(key)) {
            next.delete(key)
          } else {
            next.add(key)
          }
          return next
        })
        onToggleField(key)
      }}
      frozenColumns={frozen}
      onFrozenColumnsChange={(count) => {
        setFrozen(count)
        onFreeze(count)
      }}
    />
  )
}

async function mount() {
  const spies = {
    onFilters: vi.fn(),
    onSorts: vi.fn(),
    onGroup: vi.fn(),
    onToggleField: vi.fn(),
    onFreeze: vi.fn(),
  }
  const view = await render(<Harness {...spies} />)
  return { view, ...spies }
}

describe('MobileViewOptions', () => {
  it('filters by a value the rows hold, then clears it', async () => {
    const { view, onFilters } = await mount()
    await userEvent.click(view.getByRole('button', { name: /^Filter/ }))
    await userEvent.click(view.getByRole('button', { name: /^Status/ }))
    await userEvent.click(view.getByRole('button', { name: 'Done' }))
    expect(onFilters).toHaveBeenLastCalledWith([{ key: 'status', operator: 'is', text: 'Done' }])
    await userEvent.click(view.getByRole('button', { name: 'Back' }))
    await expect.element(view.getByText('Status: Done')).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: 'Clear filters' }))
    expect(onFilters).toHaveBeenLastCalledWith([])
  })

  it('adds a date condition from its typed value', async () => {
    const { view, onFilters } = await mount()
    await userEvent.click(view.getByRole('button', { name: /^Filter/ }))
    await userEvent.click(view.getByRole('button', { name: /^Due/ }))
    await userEvent.fill(view.getByLabelText('After', { exact: true }), '2027-01-01')
    await userEvent.click(view.getByRole('button', { name: 'Add after filter' }))
    expect(onFilters).toHaveBeenLastCalledWith([{ key: 'due', operator: 'gt', text: '2027-01-01' }])
  })

  it('sorts by a field and flips its direction', async () => {
    const { view, onSorts } = await mount()
    await userEvent.click(view.getByRole('button', { name: /^Sort/ }))
    await userEvent.click(view.getByRole('button', { name: 'Due' }))
    expect(onSorts).toHaveBeenLastCalledWith([{ key: 'due', direction: 'asc' }])
    await userEvent.click(view.getByRole('button', { name: 'Due: ascending' }))
    expect(onSorts).toHaveBeenLastCalledWith([{ key: 'due', direction: 'desc' }])
  })

  it('groups the table and hides a field', async () => {
    const { view, onGroup, onToggleField } = await mount()
    await userEvent.click(view.getByRole('button', { name: /^Group/ }))
    await userEvent.click(view.getByRole('button', { name: 'Status' }))
    expect(onGroup).toHaveBeenLastCalledWith('status')
    await userEvent.click(view.getByRole('button', { name: 'Back' }))
    await userEvent.click(view.getByRole('button', { name: /^Fields/ }))
    await userEvent.click(view.getByRole('switch', { name: 'Due' }))
    expect(onToggleField).toHaveBeenCalledWith('due')
  })

  it('picks how many leading columns stay frozen', async () => {
    const { view, onFreeze } = await mount()
    await userEvent.click(view.getByRole('button', { name: /^Freeze columns/ }))
    await userEvent.click(view.getByRole('button', { name: 'Up to Status' }))
    expect(onFreeze).toHaveBeenLastCalledWith(2)
    await userEvent.click(view.getByRole('button', { name: 'None' }))
    expect(onFreeze).toHaveBeenLastCalledWith(0)
  })
})
