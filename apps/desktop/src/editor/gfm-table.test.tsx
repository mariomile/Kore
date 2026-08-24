import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const pmRoot = page.locate('.ProseMirror')

const TABLE = '| Name | Year |\n| --- | --- |\n| Dune | 1965 |\n'

describe('NoteEditor GFM tables', () => {
  it('renders a GFM table and round-trips its markdown', async () => {
    let handle: NoteEditorHandle | null = null
    await render(
      <NoteEditor
        initialContent={TABLE}
        handleRef={(grabbed) => {
          handle = grabbed
        }}
      />,
    )
    await expect.element(pmRoot).toBeInTheDocument()
    await expect.element(page.getByText('Name')).toBeInTheDocument()
    await expect.element(page.getByText('Dune')).toBeInTheDocument()
    await expect.element(page.getByText('1965')).toBeInTheDocument()
    await expect.element(page.getByRole('table')).toBeInTheDocument()
    expect(handle!.getMarkdown()).toBe(TABLE)
  })

  it('inserts a table from the slash menu', async () => {
    await render(<NoteEditor initialContent="" />)
    await expect.element(pmRoot).toBeInTheDocument()

    await pmRoot.click()
    await userEvent.keyboard('/table')
    await expect.element(page.getByRole('option', { name: /table/i })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('table')).toBeInTheDocument()
  })
})
