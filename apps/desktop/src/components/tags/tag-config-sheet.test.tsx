import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { setPlatformSurface } from '@/lib/platform-surface'
import type { TagDefinitionState } from '@/lib/tags/tag-type-write'
import { TagConfigDialog } from './tag-config-dialog'

const definition = vi.hoisted(() => ({ current: null as unknown as TagDefinitionState }))
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))
const invalidateQueries = vi.hoisted(() => vi.fn(async () => {}))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tags/tag-type-write', () => ({
  readTagDefinition: async () => definition.current,
  saveTagType,
}))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  listNotesWithProperty: async () => [],
  listTemplates: async () => [],
  listTagTypes: async () => [],
  listTagParentCandidates: async () => [],
  listNoteTags: async () => [],
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 7 } }),
}))
vi.mock('@/routing/router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}))

function Sheet({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TagConfigDialog tag="Company" onClose={onClose} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setPlatformSurface({ mobileApp: true })
  definition.current = {
    path: 'tags/company.md',
    exists: true,
    needsConversion: false,
    properties: [{ name: 'Website', key: 'website', type: 'url' }],
    template: null,
    icon: null,
    parents: [],
  }
  saveTagType.mockClear()
  invalidateQueries.mockClear()
  navigate.mockClear()
})

afterEach(() => {
  setPlatformSurface({ mobileApp: false })
})

describe('TagConfigSheet (the phone layout of the type configuration)', () => {
  it('adds a field from its own page and saves it after the stored ones', async () => {
    const onClose = vi.fn()
    const view = await render(<Sheet onClose={onClose} />)

    // The type page lists fields as rows, not the desktop's input cards.
    await expect.element(view.getByRole('button', { name: /^Website/ })).toBeVisible()
    expect(view.getByRole('textbox', { name: 'Property name' }).query()).toBeNull()

    await view.getByRole('button', { name: 'Add field' }).click()
    await view.getByRole('textbox', { name: 'Field name' }).fill('Deal value')
    await view.getByRole('radio', { name: 'Number' }).click()
    await expect
      .element(view.getByRole('radio', { name: 'Number' }))
      .toHaveAttribute('aria-checked', 'true')
    await view.getByRole('button', { name: 'Done' }).click()

    await expect.element(view.getByRole('button', { name: /^Deal value/ })).toBeVisible()
    await view.getByRole('button', { name: 'Save', exact: true }).click()

    await expect.poll(() => saveTagType.mock.calls.length).toBe(1)
    expect(saveTagType).toHaveBeenCalledWith(
      'Company',
      [
        { name: 'Website', key: 'website', type: 'url' },
        { name: 'Deal value', key: 'deal-value', type: 'number' },
      ],
      7,
      { template: null, icon: null, parents: [] },
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('offers the advanced types behind one tap', async () => {
    const view = await render(<Sheet onClose={() => {}} />)
    await view.getByRole('button', { name: /^Website/ }).click()

    expect(view.getByRole('radio', { name: 'Formula' }).query()).toBeNull()
    await view.getByRole('button', { name: /More types/ }).click()
    await expect.element(view.getByRole('radio', { name: 'Formula' })).toBeVisible()
  })

  it('deletes a field from its page', async () => {
    const view = await render(<Sheet onClose={() => {}} />)
    await view.getByRole('button', { name: /^Website/ }).click()
    await view.getByRole('button', { name: 'Delete field' }).click()

    await expect.element(view.getByRole('button', { name: 'Add field' })).toBeVisible()
    expect(view.getByRole('button', { name: /^Website/ }).query()).toBeNull()
    await view.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => saveTagType.mock.calls.length).toBe(1)
    expect(saveTagType).toHaveBeenCalledWith('Company', [], 7, {
      template: null,
      icon: null,
      parents: [],
    })
  })

  it('saves, then opens the type notes from "show notes"', async () => {
    const view = await render(<Sheet onClose={() => {}} />)
    await view.getByRole('button', { name: /Save and show #company notes/ }).click()

    await expect.poll(() => navigate.mock.calls.length).toBe(1)
    expect(saveTagType).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({
      kind: 'allNotes',
      filter: { kind: 'tag', tag: 'Company' },
    })
  })

  it('offers the schema presets while the type has no fields', async () => {
    definition.current = { ...definition.current, properties: [] }
    const view = await render(<Sheet onClose={() => {}} />)

    await view.getByRole('button', { name: /^Project/ }).click()
    await expect.element(view.getByRole('button', { name: /Status/ }).first()).toBeVisible()
  })
})
