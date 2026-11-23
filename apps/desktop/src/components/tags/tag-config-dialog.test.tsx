import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ComponentProps, ReactElement } from 'react'
import type { TagDefinitionState } from '@/lib/tags/tag-type-write'
import { ChatContext, type ChatContextValue } from '@/providers/chat-context'
import { RouterProvider, useRouter } from '@/routing/router'
import { TagConfigDialog } from './tag-config-dialog'

/**
 * The dialog under a real query client (the target selector queries tag
 * types) and a router (Suggest with AI navigates to the chat).
 */
function Dialog(props: ComponentProps<typeof TagConfigDialog>): ReactElement {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider>
        <TagConfigDialog {...props} />
        <RouteKind />
      </RouterProvider>
    </QueryClientProvider>
  )
}

/** The routed screen, so a test can see where the dialog navigated. */
function RouteKind(): ReactElement {
  return <output aria-label="route">{useRouter().route.kind}</output>
}

const definition = vi.hoisted(() => ({
  current: {
    path: 'tags/book.md',
    exists: false,
    needsConversion: false,
    properties: [],
    template: null,
    folder: null,
    icon: null,
    parents: [],
  } as TagDefinitionState,
}))
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))
const invalidateQueries = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/tags/tag-type-write', () => ({
  readTagDefinition: async () => definition.current,
  saveTagType,
}))
const propertyUses = vi.hoisted(() => ({
  current: [] as { notePath: string; value: unknown }[],
}))
const templates = vi.hoisted(() => ({
  current: [] as { path: string; title: string; mtime: number }[],
}))
const commitNoteFrontmatter = vi.hoisted(() => vi.fn(async () => {}))
const tagTypesRows = vi.hoisted(() => ({
  current: [] as { tagKey: string; notePath: string }[],
}))
const parentCandidates = vi.hoisted(() => ({ current: [] as string[] }))
const noteTagsRows = vi.hoisted(() => ({
  current: [] as { tag: string; count: number }[],
}))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  listNotesWithProperty: async () => propertyUses.current,
  listTemplates: async () => templates.current,
  listTagTypes: async () => tagTypesRows.current,
  listTagParentCandidates: async () => parentCandidates.current,
  listNoteTags: async () => noteTagsRows.current,
  listTagOccurrences: async () => [],
}))
vi.mock('@/lib/note-frontmatter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/note-frontmatter')>()),
  commitNoteFrontmatter,
}))
const moveNoteCarryingSession = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/editor/move-note', () => ({ moveNoteCarryingSession }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 7 } }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}))

beforeEach(() => {
  definition.current = {
    path: 'tags/book.md',
    exists: false,
    needsConversion: false,
    properties: [],
    template: null,
    folder: null,
    icon: null,
    parents: [],
  }
  propertyUses.current = []
  templates.current = []
  tagTypesRows.current = []
  noteTagsRows.current = []
  saveTagType.mockClear()
  invalidateQueries.mockClear()
  commitNoteFrontmatter.mockClear()
  moveNoteCarryingSession.mockClear()
})

describe('TagConfigDialog', () => {
  it('opens the rename from the header and previews it before anything is written', async () => {
    const view = await render(<Dialog tag="Book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Rename' }).click()
    await expect.element(view.getByRole('heading', { name: 'Rename #Book' })).toBeVisible()
    await view.getByRole('textbox', { name: 'New tag name' }).fill('novel')

    // No note carries it here, so the preview says so and nothing can run.
    await expect.element(view.getByText(/No note carries/)).toBeVisible()
    await expect
      .element(view.getByRole('button', { name: 'Rename', exact: true }).last())
      .toBeDisabled()
  })

  it('shows the stored schema and saves an added property with a derived key', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const onClose = vi.fn()
    const view = await render(<Dialog tag="Book" onClose={onClose} />)

    // The left pane lists the properties; picking one opens its settings.
    await view.getByRole('button', { name: 'Author', exact: true }).click()
    await expect.element(view.getByRole('textbox', { name: 'Property name' })).toHaveValue('Author')

    // A new property opens straight away, its name focused.
    await view.getByRole('button', { name: 'Add property' }).click()
    await view.getByRole('textbox', { name: 'Property name' }).fill('Read on')

    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'Book',
      [
        { name: 'Author', key: 'author', type: 'text' },
        { name: 'Read on', key: 'read-on', type: 'text' },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
    expect(invalidateQueries).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the type folder and keeps a per-note layout written in the tag file', async () => {
    definition.current = {
      path: 'tags/project.md',
      exists: true,
      needsConversion: false,
      properties: [],
      template: null,
      folder: 'Active/Projects/{title}',
      icon: '📁',
      parents: [],
    }
    const view = await render(<Dialog tag="project" onClose={vi.fn()} />)

    await expect
      .element(view.getByRole('combobox', { name: 'Folder for new notes' }))
      .toHaveTextContent('Active/Projects')
    await expect
      .element(view.getByText('New notes go here, each in its own folder'))
      .toBeInTheDocument()
    // The settings offer one folder per tag; the per-note layout is not a choice here.
    expect(view.getByRole('switch').query()).toBeNull()

    await view.getByRole('button', { name: 'Type icon' }).click()
    await view.getByRole('button', { name: 'Remove icon' }).click()
    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith('project', [], 7, {
      template: null,
      folder: 'Active/Projects/{title}',
      icon: null,
      parents: [],
    })
  })

  it('picks a tag to build on and saves it as the definition’s parents', async () => {
    parentCandidates.current = ['contact', 'person']
    definition.current = {
      path: 'tags/client.md',
      exists: true,
      needsConversion: false,
      properties: [],
      template: null,
      folder: null,
      icon: null,
      parents: ['person'],
    }
    const view = await render(<Dialog tag="client" onClose={vi.fn()} />)

    await expect.element(view.getByText('#person', { exact: true })).toBeInTheDocument()
    await view.getByRole('combobox', { name: 'Tag #client builds on' }).click()
    await view.getByRole('option', { name: '#contact' }).click()
    await view.getByRole('button', { name: 'Stop building on #person' }).click()
    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith('client', [], 7, {
      template: null,
      folder: null,
      icon: null,
      parents: ['contact'],
    })
    parentCandidates.current = []
  })

  it('types a relation at a target collection and saves it into the schema', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    tagTypesRows.current = [
      { tagKey: 'person', notePath: 'tags/person.md' },
      { tagKey: 'company', notePath: 'tags/company.md' },
    ]
    const view = await render(<Dialog tag="Book" onClose={() => {}} />)
    await view.getByRole('button', { name: 'Author', exact: true }).click()

    // Author becomes a relation; the Target selector appears with the typed
    // tags, defaulting to "Any note".
    await view.getByRole('combobox', { name: 'Property type' }).click()
    await view.getByRole('option', { name: 'Relation', exact: true }).click()
    const target = view.getByRole('combobox', { name: 'Relation target' })
    await expect.element(target).toBeVisible()
    await target.click()
    await view.getByRole('option', { name: '#person' }).click()

    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'Book',
      [{ name: 'Author', key: 'author', type: 'relation', target: 'person' }],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
  })

  it('offers a tag that exists on notes even without a type definition', async () => {
    definition.current = {
      path: 'tags/skills.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Topic', key: 'topic', type: 'relations' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    tagTypesRows.current = [{ tagKey: 'person', notePath: 'tags/person.md' }]
    noteTagsRows.current = [{ tag: 'topic', count: 3 }]
    const view = await render(<Dialog tag="skills" onClose={() => {}} />)
    await view.getByRole('button', { name: 'Topic', exact: true }).click()

    await view.getByRole('combobox', { name: 'Relation target' }).click()
    await expect.element(view.getByRole('option', { name: '#topic' })).toBeInTheDocument()
    await expect.element(view.getByRole('option', { name: '#person' })).toBeInTheDocument()
    await view.unmount()
  })

  it('offers conversion when an unmarked note occupies the definition path', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: true,
      properties: [],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="book" onClose={() => {}} />)

    await expect.element(view.getByText('Saving converts it', { exact: false })).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Convert & save' })).toBeEnabled()
  })

  it('renaming a used key offers migration and moves the values on confirm', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    propertyUses.current = [
      {
        notePath: 'notes/dune.md',
        value: { value: 'Frank Herbert', valueType: 'string', valueNumber: null },
      },
    ]
    const onClose = vi.fn()
    const view = await render(<Dialog tag="book" onClose={onClose} />)
    await view.getByRole('button', { name: 'Author', exact: true }).click()

    // The key editor folds behind its mono chip until asked for.
    await view.getByRole('button', { name: 'Edit frontmatter key' }).click()
    const keyInput = view.getByRole('textbox', { name: 'Frontmatter key' })
    await keyInput.fill('writer')
    await view.getByRole('button', { name: 'Save' }).click()

    // The blast radius surfaces before anything is written.
    await expect.element(view.getByText('author → writer (1 note)')).toBeInTheDocument()
    expect(saveTagType).not.toHaveBeenCalled()

    await view.getByRole('button', { name: 'Save & migrate values' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [{ name: 'Author', key: 'writer', type: 'text' }],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
    expect(commitNoteFrontmatter).toHaveBeenCalledWith(
      'notes/dune.md',
      { properties: { author: undefined, writer: 'Frank Herbert' } },
      7,
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('renaming a used key can save without migrating — values stay put', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    propertyUses.current = [
      {
        notePath: 'notes/dune.md',
        value: { value: 'Frank Herbert', valueType: 'string', valueNumber: null },
      },
    ]
    const view = await render(<Dialog tag="book" onClose={() => {}} />)
    await view.getByRole('button', { name: 'Author', exact: true }).click()

    await view.getByRole('button', { name: 'Edit frontmatter key' }).click()
    await view.getByRole('textbox', { name: 'Frontmatter key' }).fill('writer')
    await view.getByRole('button', { name: 'Save' }).click()
    await view.getByRole('button', { name: 'Save without migrating' }).click()

    expect(saveTagType).toHaveBeenCalled()
    expect(commitNoteFrontmatter).not.toHaveBeenCalled()
  })

  it('seeds an empty schema from a preset and the views strip lights up', async () => {
    const view = await render(<Dialog tag="book" onClose={() => {}} />)

    // The presets are the vault's default objects (plus Reading list), so a
    // deleted default is one click from coming back on any tag.
    await view.getByRole('button', { name: /^Project Status/ }).click()

    const nav = view.getByRole('navigation', { name: 'Tag settings' })
    await expect.element(nav.getByRole('button', { name: 'Status', exact: true })).toBeVisible()
    await expect.element(nav.getByRole('button', { name: 'Priority', exact: true })).toBeVisible()
    // The preset carries a status and a date, so Board and Calendar light
    // up in the views list — named after the property powering each.
    await expect.element(view.getByText('Grouped by Status')).toBeInTheDocument()
    await expect.element(view.getByText('Placed by Due')).toBeInTheDocument()
    // With rows on screen the presets step aside.
    expect(view.getByRole('button', { name: /^Project Status/ }).query()).toBeNull()

    await view.getByRole('button', { name: 'Save' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [
        {
          name: 'Status',
          key: 'status',
          type: 'status',
          options: ['Planned', 'Active', 'On hold', 'Done'],
        },
        { name: 'Due', key: 'due', type: 'date' },
        { name: 'Priority', key: 'priority', type: 'select', options: ['High', 'Medium', 'Low'] },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
  })

  it('hides Suggest with AI where no chat is mounted', async () => {
    const view = await render(<Dialog tag="book" onClose={() => {}} />)

    await expect.element(view.getByRole('button', { name: /^Project Status/ })).toBeVisible()
    expect(view.getByRole('button', { name: /^Suggest with AI/ }).query()).toBeNull()
  })

  it('Suggest with AI closes the dialog and opens a fresh chat with the request drafted', async () => {
    const onClose = vi.fn()
    const newChat = vi.fn(() => 'next')
    const setDraft = vi.fn()
    const chat = { status: 'idle', newChat, setDraft } as unknown as ChatContextValue
    const view = await render(
      <ChatContext value={chat}>
        <Dialog tag="type/course" onClose={onClose} />
      </ChatContext>,
    )

    await view.getByRole('button', { name: /^Suggest with AI/ }).click()

    expect(onClose).toHaveBeenCalledOnce()
    expect(newChat).toHaveBeenCalledOnce()
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('#type/course '))
    await expect.element(view.getByLabelText('route')).toHaveTextContent('chat')
    // Nothing is written by asking.
    expect(saveTagType).not.toHaveBeenCalled()
  })

  it('Suggest with AI asks about unsaved edits, then leaves for the chat', async () => {
    definition.current = { ...definition.current, exists: true, icon: '📚' }
    const onClose = vi.fn()
    const setDraft = vi.fn()
    const chat = { status: 'idle', newChat: vi.fn(), setDraft } as unknown as ChatContextValue
    const view = await render(
      <ChatContext value={chat}>
        <Dialog tag="book" onClose={onClose} />
      </ChatContext>,
    )

    await view.getByRole('button', { name: 'Type icon' }).click()
    await view.getByRole('button', { name: 'Remove icon' }).click()
    await view.getByRole('button', { name: /^Suggest with AI/ }).click()

    await expect.element(view.getByText('Discard your unsaved changes?')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    await expect.element(view.getByLabelText('route')).not.toHaveTextContent('chat')

    // Letting the edits go finishes what was asked: the chat opens with the draft.
    await view.getByRole('button', { name: 'Discard' }).click()
    expect(onClose).toHaveBeenCalled()
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('#book '))
    await expect.element(view.getByLabelText('route')).toHaveTextContent('chat')
  })

  it('turns a missing view on with one button and saves the property it added', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="book" onClose={() => {}} />)

    // A lone text property powers the table and nothing else: each view
    // that is off names the property type it needs and offers to add it.
    await expect.element(view.getByText('A column for each property')).toBeInTheDocument()
    await expect.element(view.getByText('Needs a Select or Status')).toBeInTheDocument()
    await expect.element(view.getByText('Needs a Date')).toBeInTheDocument()

    await view.getByRole('button', { name: 'Add status' }).click()
    // The new property opens for editing; back on the tag pane Board is on.
    await expect.element(view.getByRole('textbox', { name: 'Property name' })).toHaveValue('Status')
    await view
      .getByRole('navigation', { name: 'Tag settings' })
      .getByRole('button', { name: 'Tag', exact: true })
      .click()
    await expect.element(view.getByText('Grouped by Status')).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Add status' }).query()).toBeNull()

    await view.getByRole('button', { name: 'Save' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [
        { name: 'Author', key: 'author', type: 'text' },
        {
          name: 'Status',
          key: 'status',
          type: 'status',
          options: ['To do', 'In progress', 'Done'],
        },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
  })

  it("adds a view's property under a free name when its usual one is taken", async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Status', key: 'status', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Add status' }).click()
    await expect
      .element(view.getByRole('textbox', { name: 'Property name' }))
      .toHaveValue('Status 2')
    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [
        { name: 'Status', key: 'status', type: 'text' },
        {
          name: 'Status 2',
          key: 'status-2',
          type: 'status',
          options: ['To do', 'In progress', 'Done'],
        },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
  })

  it('adds, deletes and colors select options and saves the colors by name', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Status', key: 'status', type: 'select', options: ['to-read', 'done'] }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="book" onClose={() => {}} />)
    await view.getByRole('button', { name: 'Status', exact: true }).click()

    await expect
      .element(view.getByRole('textbox', { name: 'Option name: to-read' }))
      .toHaveValue('to-read')
    await view.getByRole('textbox', { name: 'Add option' }).fill('reading')
    await userEvent.keyboard('{Enter}')
    await view.getByRole('button', { name: 'Delete to-read' }).click()
    await view.getByRole('button', { name: 'Color of done' }).click()
    await view.getByRole('option', { name: 'Green' }).click()

    await view.getByRole('button', { name: 'Save' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [
        {
          name: 'Status',
          key: 'status',
          type: 'select',
          options: ['done', 'reading'],
          colors: { done: 'green' },
        },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
  })

  it('renames an option, keeps its color and starting value, and moves the notes along', async () => {
    definition.current = {
      path: 'tags/project.md',
      exists: true,
      needsConversion: false,
      properties: [
        {
          name: 'Status',
          key: 'status',
          type: 'status',
          options: ['Todo', 'Done'],
          colors: { Todo: 'gray' },
          default: 'Todo',
        },
      ],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    propertyUses.current = [
      { notePath: 'p/a.md', value: { value: 'Todo', valueType: 'string', valueNumber: null } },
      { notePath: 'p/b.md', value: { value: 'Done', valueType: 'string', valueNumber: null } },
    ]
    const onClose = vi.fn()
    const view = await render(<Dialog tag="project" onClose={onClose} />)
    await view.getByRole('button', { name: 'Status', exact: true }).click()

    await view.getByRole('textbox', { name: 'Option name: Todo' }).fill('To do')
    await expect.element(view.getByText('was Todo')).toBeInTheDocument()
    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'project',
      [
        {
          name: 'Status',
          key: 'status',
          type: 'status',
          options: ['To do', 'Done'],
          colors: { 'To do': 'gray' },
          default: 'To do',
        },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
    // Only the note on the old text is rewritten.
    expect(commitNoteFrontmatter).toHaveBeenCalledTimes(1)
    expect(commitNoteFrontmatter).toHaveBeenCalledWith(
      'p/a.md',
      { properties: { status: 'To do' } },
      7,
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('offers to bind the type to the nested tag its notes use and moves the definition', async () => {
    definition.current = {
      path: 'tags/project.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Due', key: 'due', type: 'date' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    noteTagsRows.current = [
      { tag: 'type/project', count: 165 },
      { tag: 'domain/ai', count: 40 },
    ]
    tagTypesRows.current = [{ tagKey: 'project', notePath: 'tags/project.md' }]
    const view = await render(<Dialog tag="project" onClose={() => {}} />)

    await expect.element(view.getByText('165 notes use #type/project.')).toBeInTheDocument()
    await view.getByRole('button', { name: 'Use #type/project' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'project',
      [{ name: 'Due', key: 'due', type: 'date' }],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
    expect(moveNoteCarryingSession).toHaveBeenCalledWith(
      'tags/project.md',
      'tags/type/project.md',
      7,
    )
  })

  it('gives fields a starting value and keeps a stored one', async () => {
    definition.current = {
      path: 'tags/invoice.md',
      exists: true,
      needsConversion: false,
      properties: [
        { name: 'Number', key: 'number', type: 'number', default: 'next-number' },
        { name: 'Status', key: 'status', type: 'select', options: ['draft', 'sent'] },
      ],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="invoice" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Number', exact: true }).click()
    await expect
      .element(view.getByRole('combobox', { name: 'Starting value' }))
      .toHaveTextContent('Next number')
    await view.getByRole('button', { name: 'Status', exact: true }).click()
    await view.getByRole('combobox', { name: 'Starting value' }).click()
    await view.getByRole('option', { name: 'Fixed value' }).click()
    await view.getByRole('combobox', { name: 'Fixed starting value' }).click()
    await view.getByRole('option', { name: 'draft' }).click()

    await view.getByRole('button', { name: 'Save' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'invoice',
      [
        { name: 'Number', key: 'number', type: 'number', default: 'next-number' },
        {
          name: 'Status',
          key: 'status',
          type: 'select',
          options: ['draft', 'sent'],
          default: 'draft',
        },
      ],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
  })

  it('disables save while a row is invalid (duplicate key)', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Add property' }).click()
    await view.getByRole('textbox', { name: 'Property name' }).fill('Author')

    await expect.element(view.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(saveTagType).not.toHaveBeenCalled()
  })

  it('picks an icon and saves it with the schema', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="Book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Type icon' }).click()
    await view.getByRole('button', { name: '📚' }).click()
    await expect.element(view.getByRole('button', { name: 'Type icon' })).toHaveTextContent('📚')

    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'Book',
      [{ name: 'Author', key: 'author', type: 'text' }],
      7,
      { template: null, folder: null, icon: '📚', parents: [] },
    )
  })

  it('takes any typed emoji and removes a stored icon', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [],
      template: null,
      folder: null,
      icon: '📚',
      parents: [],
    }
    const view = await render(<Dialog tag="Book" onClose={() => {}} />)

    await expect.element(view.getByRole('button', { name: 'Type icon' })).toHaveTextContent('📚')
    await view.getByRole('button', { name: 'Type icon' }).click()
    await view.getByRole('textbox', { name: 'Any emoji' }).fill('🦄')
    await expect.element(view.getByRole('button', { name: 'Type icon' })).toHaveTextContent('🦄')

    await view.getByRole('button', { name: 'Type icon' }).click()
    await view.getByRole('button', { name: 'Remove icon' }).click()
    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith('Book', [], 7, {
      template: null,
      folder: null,
      icon: null,
      parents: [],
    })
  })

  it('picks a symbol icon and stores it as an icon: reference', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const view = await render(<Dialog tag="Book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Type icon' }).click()
    await view
      .getByRole('group', { name: 'Symbol icons' })
      .getByRole('button', { name: 'folder', exact: true })
      .click()
    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith('Book', [], 7, {
      template: null,
      folder: null,
      icon: 'icon:folder',
      parents: [],
    })
  })

  it('deletes an option notes use: undo, or merge its notes into another on save', async () => {
    definition.current = {
      path: 'tags/project.md',
      exists: true,
      needsConversion: false,
      properties: [
        { name: 'Status', key: 'status', type: 'status', options: ['paused', 'in pausa', 'old'] },
      ],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    propertyUses.current = [
      { notePath: 'p/a.md', value: { value: 'in pausa', valueType: 'string', valueNumber: null } },
      { notePath: 'p/b.md', value: { value: 'paused', valueType: 'string', valueNumber: null } },
      { notePath: 'p/c.md', value: { value: 'old', valueType: 'string', valueNumber: null } },
    ]
    const view = await render(<Dialog tag="project" onClose={() => {}} />)
    await view.getByRole('button', { name: 'Status', exact: true }).click()

    // Undo brings a deleted option back.
    await view.getByRole('button', { name: 'Delete paused' }).click()
    await view.getByRole('button', { name: 'Restore paused' }).click()
    await expect
      .element(view.getByRole('textbox', { name: 'Option name: paused' }))
      .toBeInTheDocument()

    // One merges into another option, one comes off its notes.
    await view.getByRole('button', { name: 'Delete in pausa' }).click()
    await view.getByRole('combobox', { name: 'Notes using in pausa' }).click()
    await view.getByRole('option', { name: 'Move 1 note to paused' }).click()
    await view.getByRole('button', { name: 'Delete old' }).click()
    await expect
      .element(view.getByRole('combobox', { name: 'Notes using old' }))
      .toHaveTextContent('Remove from 1 note')

    await view.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => saveTagType.mock.calls.length).toBe(1)
    expect(saveTagType).toHaveBeenCalledWith(
      'project',
      [{ name: 'Status', key: 'status', type: 'status', options: ['paused'] }],
      7,
      { template: null, folder: null, icon: null, parents: [] },
    )
    await expect.poll(() => commitNoteFrontmatter.mock.calls.length).toBe(2)
    expect(commitNoteFrontmatter.mock.calls).toEqual([
      ['p/a.md', { properties: { status: 'paused' } }, 7],
      ['p/c.md', { properties: { status: undefined } }, 7],
    ])
  })

  it('confirms before closing with unsaved changes', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
      folder: null,
      icon: null,
      parents: [],
    }
    const onClose = vi.fn()
    const view = await render(<Dialog tag="book" onClose={onClose} />)
    await view.getByRole('button', { name: 'Author', exact: true }).click()
    await view.getByRole('button', { name: 'Delete property' }).click()

    await view.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(view.getByText('Discard your unsaved changes?')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    await view.getByRole('button', { name: 'Keep editing' }).click()
    await view.getByRole('button', { name: 'Cancel' }).click()
    await view.getByRole('button', { name: 'Discard' }).click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
