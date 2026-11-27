import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { LooseFile } from '@kore/core'
import { FolderFilesSection } from './folder-files-section'

vi.mock('@/hooks/use-note-card-images', () => ({
  usePassiveImageResolver: () => () => null,
}))

function file(index: number, extension = 'pdf'): LooseFile {
  return {
    path: `Jobs/CV ${index}.${extension}`,
    name: `CV ${index}.${extension}`,
    extension,
    kind: extension === 'pdf' ? 'pdf' : 'sheet',
    size: 90_000,
    modifiedMs: index,
  }
}

const files = Array.from({ length: 9 }, (_, index) => file(index))

describe('FolderFilesSection', () => {
  it('shows two lines of rows above the notes, and the rest on Show all', async () => {
    // 30rem fits two 15rem columns: two lines are four rows.
    const view = await render(
      <div style={{ width: '31rem' }}>
        <FolderFilesSection files={files} onOpen={vi.fn()} lines={2} className="" />
      </div>,
    )

    await expect.element(view.getByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(view.getByRole('listitem').elements()).toHaveLength(4)
    const showAll = view.getByRole('button', { name: 'Show all 9' })
    await expect.element(showAll).toHaveAttribute('aria-expanded', 'false')

    await showAll.click()
    expect(view.getByRole('listitem').elements()).toHaveLength(9)
    await view.getByRole('button', { name: 'Show less' }).click()
    expect(view.getByRole('listitem').elements()).toHaveLength(4)
    await view.unmount()
  })

  it('lists every file, with no Show all, when nothing is below them', async () => {
    const view = await render(
      <div style={{ width: '31rem' }}>
        <FolderFilesSection files={files} onOpen={vi.fn()} lines={null} className="" />
      </div>,
    )

    expect(view.getByRole('listitem').elements()).toHaveLength(9)
    await expect.element(view.getByRole('button', { name: /^Show/ })).not.toBeInTheDocument()
    await view.unmount()
  })

  it('names a file without its extension, which sits in the line under it', async () => {
    const onOpen = vi.fn()
    const view = await render(
      <FolderFilesSection
        files={[file(1), file(1, 'xlsx')]}
        onOpen={onOpen}
        lines={2}
        className=""
      />,
    )

    await expect.element(view.getByText('PDF · 88 KB')).toBeInTheDocument()
    await expect.element(view.getByText('XLSX · 88 KB')).toBeInTheDocument()
    expect(view.getByText('CV 1', { exact: true }).elements()).toHaveLength(2)

    await view.getByRole('button', { name: 'CV 1.xlsx, XLSX · 88 KB' }).click()
    expect(onOpen).toHaveBeenCalledWith('Jobs/CV 1.xlsx')
    await view.unmount()
  })

  it('renders nothing for a folder without files', async () => {
    const view = await render(<FolderFilesSection files={[]} onOpen={vi.fn()} lines={2} />)
    expect(view.container.textContent).toBe('')
    await view.unmount()
  })
})
