import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ReactNode } from 'react'
import type { BaseNoteRow } from '@kore/core'
import { RouterProvider, useRouter } from '@/routing/router'

const loadBaseRows = vi.hoisted(() => vi.fn<() => Promise<BaseNoteRow[]>>())
const readBaseFile = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const listBaseFiles = vi.hoisted(() => vi.fn<() => Promise<string[]>>())
const createBaseNote = vi.hoisted(() => vi.fn(async () => 'notes/new.md'))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  loadBaseRows,
  readBaseFile,
  listBaseFiles,
  createBaseNote,
}))
const commitProperty = vi.hoisted(() =>
  vi.fn<(path: string, key: string, value: unknown) => void>(),
)
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
  invalidateOnNextIndexApply: () => {},
}))
const toastAdd = vi.hoisted(() => vi.fn((_toast: { title?: string }) => 'toast-id'))
vi.mock('@/components/ui/toast', () => ({ toast: { add: toastAdd, close: () => {} } }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

const { BaseViewContent } = await import('./base-view-content')
const { useBaseView } = await import('./use-base-view')
const { useCreateBaseNote } = await import('./use-create-base-note')
const { useCommitNoteProperty } = await import('@/lib/tags/use-commit-note-property')

function note(path: string, properties: BaseNoteRow['properties']): BaseNoteRow {
  return {
    path,
    title: (path.split('/').at(-1) ?? path).replace(/\.md$/, ''),
    mtime: Date.now(),
    ctime: Date.now(),
    size: 100,
    tags: ['type/project'],
    properties,
    links: [],
    backlinks: [],
  }
}

const BASE = `
filters: file.hasTag("type/project")
formulas:
  label: status.upper()
properties:
  formula.label:
    displayName: Stato
views:
  - type: table
    name: Tutti
    order: [file.name, formula.label]
  - type: table
    name: Attivi
    filters: status == "active"
    order: [file.name]
  - type: table
    name: Modifica
    order: [file.name, status, formula.label]
  - type: list
    name: Lista
    filters:
      or:
        - status == "active"
        - status == "hold"
    order: [file.name]
  - type: kanban
    name: Board
    order: [file.name]
    groupBy:
      property: status
      direction: ASC
`

beforeEach(() => {
  loadBaseRows
    .mockReset()
    .mockResolvedValue([
      note('Projects/Kore.md', { status: 'active' }),
      note('Projects/Captoo.md', { status: 'hold' }),
    ])
  readBaseFile.mockReset().mockResolvedValue(BASE)
  listBaseFiles.mockReset().mockResolvedValue(['Home/Projects.base'])
  commitProperty.mockReset()
  createBaseNote.mockClear()
  toastAdd.mockClear()
})

function drag(type: string, target: Element, data: DataTransfer): void {
  target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }))
}

/** The renderer `![[x.base]]` embeds use, over one view of the base. */
function View({ name }: { name: string }): ReactNode {
  const { navigate } = useRouter()
  const state = useBaseView('Home/Projects.base', name)
  const onEdit = useCommitNoteProperty()
  const openNote = (path: string): void => navigate({ kind: 'note', path })
  const onCreate = useCreateBaseNote(state.status === 'ready' ? state : null, openNote)
  return state.status === 'ready' ? (
    <BaseViewContent
      result={state.result}
      onOpenNote={openNote}
      onEdit={onEdit}
      onCreate={onCreate}
    />
  ) : null
}

async function renderView(name: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'base', path: 'Home/Projects.base', view: name }}>
        <View name={name} />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

describe('BaseViewContent', () => {
  it('edits a note property in the table, never a formula', async () => {
    const view = await renderView('Modifica')
    await expect.element(view.getByText('ACTIVE', { exact: true })).toBeInTheDocument()
    await expect
      .element(view.getByRole('button', { name: 'Edit Stato of Kore' }))
      .not.toBeInTheDocument()
    await view.getByRole('button', { name: 'Edit status of Kore' }).click()
    const input = view.getByRole('textbox', { name: 'status of Kore' })
    await input.fill('done')
    await userEvent.keyboard('{Enter}')
    expect(commitProperty).toHaveBeenCalledWith('Projects/Kore.md', 'status', 'done')
    await expect.element(view.getByText('done', { exact: true })).toBeInTheDocument()
  })

  it('drops an edit on Escape', async () => {
    const view = await renderView('Modifica')
    await view.getByRole('button', { name: 'Edit status of Captoo' }).click()
    await view.getByRole('textbox', { name: 'status of Captoo' }).fill('nope')
    await userEvent.keyboard('{Escape}')
    await expect
      .element(view.getByRole('button', { name: 'Edit status of Captoo' }))
      .toBeInTheDocument()
    expect(commitProperty).not.toHaveBeenCalled()
  })

  it('moves a card to another lane by writing the lane value', async () => {
    const view = await renderView('Board')
    await expect.element(view.getByRole('region', { name: 'hold' })).toBeInTheDocument()
    const source = view.container.querySelector('[data-note-path="Projects/Kore.md"]')!
    const lane = view.getByRole('region', { name: 'hold' }).element()
    const data = new DataTransfer()
    drag('dragstart', source, data)
    await expect.poll(() => source.className).toContain('opacity-50')
    drag('dragover', lane, data)
    drag('drop', lane, data)
    expect(commitProperty).toHaveBeenCalledWith('Projects/Kore.md', 'status', 'hold')
  })

  it('adds a note from a lane, prefilled with the filters and the lane value', async () => {
    const view = await renderView('Board')
    await view.getByRole('button', { name: 'New note in hold' }).click()
    await view.getByRole('textbox', { name: 'New note in hold, title' }).fill('Ship it')
    await userEvent.keyboard('{Enter}')
    expect(createBaseNote).toHaveBeenCalledWith(
      'Ship it',
      { folder: null, properties: { status: 'hold' }, tags: ['type/project'] },
      1,
    )
    await Promise.resolve()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('adds a note from a list, saying when it falls outside the view', async () => {
    const view = await renderView('Lista')
    await view.getByRole('button', { name: 'New note' }).click()
    await view.getByRole('textbox', { name: 'New note, title' }).fill('Idea')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => toastAdd.mock.calls[0]?.[0].title).toBe('Created “Idea”')
  })
})
