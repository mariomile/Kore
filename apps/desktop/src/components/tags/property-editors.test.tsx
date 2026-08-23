import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { CollectionValue, TagProperty } from '@reflect/core'
import { PropertyValueEditor } from './property-editors'

const onCommit = vi.fn()

beforeEach(() => {
  onCommit.mockClear()
})

function stored(value: string, valueType: CollectionValue['valueType']): CollectionValue {
  return { value, valueType, valueNumber: valueType === 'number' ? Number(value) : null }
}

function editor(property: TagProperty, value?: CollectionValue) {
  return (
    <PropertyValueEditor property={property} value={value} onCommit={onCommit}>
      <span>{value?.value ?? 'Empty'}</span>
    </PropertyValueEditor>
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

  it('toggles multi-select entries into a list value', async () => {
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

    await view.getByRole('option', { name: 'ai' }).click()
    // The stored value prop hasn't refreshed, so the second toggle still
    // starts from ['ai'] — removing it empties the list, which deletes.
    expect(onCommit).toHaveBeenLastCalledWith(undefined)
  })
})
