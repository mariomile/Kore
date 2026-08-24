import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CollectionValue, TagProperty, WikiLinkSuggestion } from '@reflect/core'
import { PropertyValueEditor } from './property-editors'

const relationSuggestions = vi.hoisted(() => ({ current: [] as WikiLinkSuggestion[] }))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  suggestWikiLinkTargets: async () => ({
    suggestions: relationSuggestions.current,
    claimedTargetKeys: [],
    queryReadsAsDate: false,
  }),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))

const onCommit = vi.fn()

beforeEach(() => {
  onCommit.mockClear()
})

function stored(value: string, valueType: CollectionValue['valueType']): CollectionValue {
  return { value, valueType, valueNumber: valueType === 'number' ? Number(value) : null }
}

function editor(property: TagProperty, value?: CollectionValue) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PropertyValueEditor property={property} value={value} onCommit={onCommit}>
        <span>{value?.value ?? 'Empty'}</span>
      </PropertyValueEditor>
    </QueryClientProvider>
  )
}

describe('PropertyValueEditor', () => {
  it('commits text on Enter and deletes on an emptied input', async () => {
    const property: TagProperty = { name: 'Author', key: 'author', type: 'text' }
    const view = await render(editor(property, stored('Le Guin', 'string')))

    await view.getByRole('button', { name: 'Edit Author' }).click()
    const input = view.getByRole('textbox', { name: 'Author' })
    await input.fill('Ursula K. Le Guin')
    await userEvent.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledWith('Ursula K. Le Guin')

    await view.getByRole('button', { name: 'Edit Author' }).click()
    await view.getByRole('textbox', { name: 'Author' }).fill('')
    await userEvent.keyboard('{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(undefined)
  })

  it('cancels on Escape without committing', async () => {
    const property: TagProperty = { name: 'Author', key: 'author', type: 'text' }
    const view = await render(editor(property, stored('Le Guin', 'string')))

    await view.getByRole('button', { name: 'Edit Author' }).click()
    await view.getByRole('textbox', { name: 'Author' }).fill('changed')
    await userEvent.keyboard('{Escape}')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('never commits an untouched draft — open + blur leaves a mismatched value alone', async () => {
    // `topics: [a, b]` under a text column: the seed is '' (lists have no
    // text form), and committing that would erase the list. Tolerated,
    // never destroyed.
    const property: TagProperty = { name: 'Topics', key: 'topics', type: 'text' }
    const view = await render(editor(property, stored('["a","b"]', 'list')))

    await view.getByRole('button', { name: 'Edit Topics' }).click()
    await expect.element(view.getByRole('textbox', { name: 'Topics' })).toBeInTheDocument()
    // Click-away, not Escape: the blur-commit path must hit the
    // untouched-draft guard, not the cancel flag.
    await userEvent.click(document.body)
    await expect.element(view.getByRole('textbox', { name: 'Topics' })).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('treats unparseable numeric input as a typo, not a delete', async () => {
    const property: TagProperty = { name: 'Rating', key: 'rating', type: 'number' }
    const view = await render(
      <PropertyValueEditor property={property} value={stored('4', 'number')} onCommit={onCommit}>
        <span>4</span>
      </PropertyValueEditor>,
    )

    await view.getByRole('button', { name: 'Edit Rating' }).click()
    const input = view.getByRole('spinbutton', { name: 'Rating' })
    await input.fill('')
    // Typed, not filled: a half-typed exponent is what real hands produce,
    // and the DOM reports '' for it (badInput) — which must not read as an
    // intentional clear of the stored value.
    await userEvent.keyboard('4e{Enter}')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits numbers as numbers', async () => {
    const property: TagProperty = { name: 'Rating', key: 'rating', type: 'number' }
    const view = await render(editor(property))

    await view.getByRole('button', { name: 'Edit Rating' }).click()
    await view.getByRole('spinbutton', { name: 'Rating' }).fill('4.5')
    await userEvent.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledWith(4.5)
  })

  it('toggles a checkbox in place', async () => {
    const property: TagProperty = { name: 'Read', key: 'read', type: 'checkbox' }
    const view = await render(editor(property, stored('true', 'boolean')))

    await view.getByRole('checkbox', { name: 'Read' }).click()
    expect(onCommit).toHaveBeenCalledWith(false)
  })

  it('picks a select option, and re-picking it clears the value', async () => {
    const property: TagProperty = {
      name: 'Status',
      key: 'status',
      type: 'select',
      options: ['to-read', 'done'],
    }
    const view = await render(editor(property, stored('to-read', 'string')))

    await view.getByRole('button', { name: 'Edit Status' }).click()
    await view.getByRole('option', { name: 'done' }).click()
    expect(onCommit).toHaveBeenCalledWith('done')

    await view.getByRole('button', { name: 'Edit Status' }).click()
    await view.getByRole('option', { name: 'to-read' }).click()
    expect(onCommit).toHaveBeenLastCalledWith(undefined)
  })

  it('Clear deletes the key even when the stored value is a mismatched list', async () => {
    const property: TagProperty = {
      name: 'Status',
      key: 'status',
      type: 'select',
      options: ['a', 'b'],
    }
    const view = await render(editor(property, stored('["a","b"]', 'list')))

    await view.getByRole('button', { name: 'Edit Status' }).click()
    await view.getByRole('option', { name: 'Clear' }).click()
    expect(onCommit).toHaveBeenCalledWith(undefined)
  })

  it('links a note through the relation picker and commits the wiki-link value', async () => {
    relationSuggestions.current = [
      {
        target: 'Ursula K. Le Guin',
        insertText: 'Ursula K. Le Guin',
        path: 'notes/ursula.md',
        title: 'Ursula K. Le Guin',
        alias: null,
        date: null,
      },
    ]
    const property: TagProperty = { name: 'Author note', key: 'author-note', type: 'relation' }
    const view = await render(editor(property))

    await view.getByRole('button', { name: 'Edit Author note' }).click()
    await view.getByRole('option', { name: 'Ursula K. Le Guin' }).click()
    expect(onCommit).toHaveBeenCalledWith('[[Ursula K. Le Guin]]')
  })

  it('clears a relation from the picker', async () => {
    relationSuggestions.current = []
    const property: TagProperty = { name: 'Author note', key: 'author-note', type: 'relation' }
    const view = await render(
      editor(property, { value: '[[Someone]]', valueType: 'string', valueNumber: null }),
    )

    await view.getByRole('button', { name: 'Edit Author note' }).click()
    await view.getByRole('option', { name: 'Clear' }).click()
    expect(onCommit).toHaveBeenCalledWith(undefined)
  })

  it('toggles multi-relation links against the popover-local list', async () => {
    relationSuggestions.current = [
      {
        target: 'Frank Herbert',
        insertText: 'Frank Herbert',
        path: 'notes/herbert.md',
        title: 'Frank Herbert',
        alias: null,
        date: null,
      },
    ]
    const property: TagProperty = { name: 'Authors', key: 'authors', type: 'relations' }
    const view = await render(editor(property, stored('["[[Le Guin]]"]', 'list')))

    await view.getByRole('button', { name: 'Edit Authors' }).click()
    // The stored link lists first (one-click unlink); the suggestion adds.
    await view.getByRole('option', { name: 'Frank Herbert' }).click()
    expect(onCommit).toHaveBeenCalledWith(['[[Le Guin]]', '[[Frank Herbert]]'])

    // The prop hasn't refreshed (write → watcher → refetch), but the second
    // toggle builds on the first — unlinking Le Guin keeps Herbert.
    await view.getByRole('option', { name: 'Le Guin' }).click()
    expect(onCommit).toHaveBeenLastCalledWith(['[[Frank Herbert]]'])
  })

  it('deletes the key on the last unlink of a multi-relation', async () => {
    relationSuggestions.current = []
    const property: TagProperty = { name: 'Authors', key: 'authors', type: 'relations' }
    const view = await render(editor(property, stored('["[[Le Guin]]"]', 'list')))

    await view.getByRole('button', { name: 'Edit Authors' }).click()
    await view.getByRole('option', { name: 'Le Guin' }).click()
    expect(onCommit).toHaveBeenCalledWith(undefined)
  })

  it('Clear deletes a multi-relation key in one gesture', async () => {
    relationSuggestions.current = []
    const property: TagProperty = { name: 'Authors', key: 'authors', type: 'relations' }
    const view = await render(
      editor(property, stored('["[[Le Guin]]","[[Frank Herbert]]"]', 'list')),
    )

    await view.getByRole('button', { name: 'Edit Authors' }).click()
    await view.getByRole('option', { name: 'Clear' }).click()
    expect(onCommit).toHaveBeenCalledWith(undefined)
  })

  it('toggles multi-select entries against the popover-local list, not the stale prop', async () => {
    const property: TagProperty = {
      name: 'Topics',
      key: 'topics',
      type: 'multiselect',
      options: ['ai', 'product'],
    }
    const view = await render(editor(property, stored('["ai"]', 'list')))

    await view.getByRole('button', { name: 'Edit Topics' }).click()
    await view.getByRole('option', { name: 'product' }).click()
    expect(onCommit).toHaveBeenCalledWith(['ai', 'product'])

    // The stored prop hasn't refreshed yet (write → watcher → refetch), but
    // the second toggle must build on the first — removing 'ai' keeps
    // 'product' instead of emptying the list.
    await view.getByRole('option', { name: 'ai' }).click()
    expect(onCommit).toHaveBeenLastCalledWith(['product'])
  })

  it('picks a status option the same way as a select', async () => {
    const property: TagProperty = {
      name: 'Stage',
      key: 'stage',
      type: 'status',
      options: ['todo', 'done'],
    }
    const view = await render(editor(property, stored('todo', 'string')))

    await view.getByRole('button', { name: 'Edit Stage' }).click()
    await view.getByRole('option', { name: 'done' }).click()
    expect(onCommit).toHaveBeenCalledWith('done')
  })

  it('commits a rating as an integer 1–5', async () => {
    const property: TagProperty = { name: 'Score', key: 'score', type: 'rating' }
    const view = await render(editor(property))

    await view.getByRole('button', { name: 'Edit Score' }).click()
    await view.getByRole('spinbutton', { name: 'Score' }).fill('4')
    await userEvent.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledWith(4)
  })

  it('commits files as a list of paths', async () => {
    const property: TagProperty = { name: 'Attachments', key: 'attachments', type: 'files' }
    const view = await render(editor(property))

    await view.getByRole('button', { name: 'Edit Attachments' }).click()
    await view.getByRole('textbox', { name: 'Attachments' }).fill('assets/scan.pdf, cover.png')
    await userEvent.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledWith(['assets/scan.pdf', 'cover.png'])
  })

  it('does not open an editor for a view-only rollup', async () => {
    const property: TagProperty = {
      name: 'Author score',
      key: 'author-score',
      type: 'rollup',
      rollup: { relation: 'author', property: 'score', aggregation: 'original' },
    }
    const view = await render(editor(property, stored('5', 'number')))

    await expect.element(view.getByRole('button', { name: 'Edit Author score' })).not.toBeInTheDocument()
    await expect.element(view.getByText('5')).toBeInTheDocument()
  })
})
