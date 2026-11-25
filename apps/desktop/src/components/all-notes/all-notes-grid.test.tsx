import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { LooseFile, NoteListEntry } from '@kore/core'
import { AllNotesGrid } from './all-notes-grid'

const pictures = new Map<string, string>()
vi.mock('@/hooks/use-note-card-images', () => ({
  noImageUrl: () => null,
  usePassiveImageResolver: () => () => null,
  useFirstImages: () => pictures,
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { dateFormat: 'mdy', timeFormat: '12h', allNotesSort: 'updated-desc' },
  }),
}))
vi.mock('./folder-files', () => ({
  FileCard: ({ file }: { file: LooseFile }) => <div data-testid="file-card">{file.name}</div>,
}))
vi.mock('./note-card-preview', () => ({
  NoteCardPreview: () => (
    <div data-testid="note-card-preview">
      {Array.from({ length: 40 }, (_, index) => (
        <p key={index}>Overflow line {index} that must stay above the footer.</p>
      ))}
    </div>
  ),
}))

const note: NoteListEntry = {
  path: 'notes/log.md',
  title: 'Log',
  snippet: 'unused',
  tags: ['company'],
  mtime: new Date(2020, 0, 15, 12, 0).getTime(),
  isPinned: false,
}

describe('AllNotesGrid card clipping', () => {
  it('keeps the clamped preview above the footer and inside the card', async () => {
    const view = await render(
      <div style={{ width: '36rem' }}>
        <AllNotesGrid notes={[note]} tag={null} onOpen={vi.fn()} />
      </div>,
    )

    await expect.element(view.getByText('Log')).toBeInTheDocument()
    const card = view.getByRole('button', { name: /Log/ }).element()
    const slot = view.getByTestId('note-card-preview-slot').element()
    const footer = view.getByText('company').element()
    const slotBox = slot.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    const footerBox = footer.getBoundingClientRect()
    expect(slotBox.bottom).toBeLessThanOrEqual(footerBox.top + 1)
    expect(slotBox.bottom).toBeLessThanOrEqual(cardBox.bottom + 1)
    expect(slotBox.left).toBeGreaterThanOrEqual(cardBox.left)
    expect(slotBox.right).toBeLessThanOrEqual(cardBox.right + 1)
    expect(slot.scrollHeight).toBeGreaterThan(slot.clientHeight)
    await view.unmount()
  })

  it('leads with the picture band and still keeps the preview inside the card', async () => {
    pictures.set(
      note.path,
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    )
    const view = await render(
      <div style={{ width: '36rem' }}>
        <AllNotesGrid notes={[note]} tag={null} onOpen={vi.fn()} />
      </div>,
    )

    const picture = view.getByTestId('note-card-picture')
    await expect.element(picture).toBeInTheDocument()
    const card = view.getByRole('button', { name: /Log/ }).element()
    const pictureBox = picture.element().getBoundingClientRect()
    const slotBox = view.getByTestId('note-card-preview-slot').element().getBoundingClientRect()
    const footerBox = view.getByText('company').element().getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    // Edge to edge: only the card's own 1px border sits around the band.
    expect(Math.abs(pictureBox.top - cardBox.top)).toBeLessThanOrEqual(1)
    expect(cardBox.width - pictureBox.width).toBeLessThanOrEqual(2)
    expect(slotBox.top).toBeGreaterThanOrEqual(pictureBox.bottom - 1)
    expect(slotBox.bottom).toBeLessThanOrEqual(footerBox.top + 1)
    pictures.clear()
    await view.unmount()
  })
})

describe("AllNotesGrid with a folder's files", () => {
  it('deals files among the notes in one order', async () => {
    const newer: NoteListEntry = {
      ...note,
      path: 'notes/new.md',
      title: 'New',
      mtime: note.mtime + 2,
    }
    const file: LooseFile = {
      path: 'notes/deck.pdf',
      name: 'deck.pdf',
      extension: 'pdf',
      kind: 'pdf',
      size: 1,
      modifiedMs: note.mtime + 1,
    }
    const view = await render(
      <div style={{ width: '60rem' }}>
        <AllNotesGrid notes={[newer, note]} files={[file]} tag={null} onOpen={vi.fn()} />
      </div>,
    )

    await expect.element(view.getByTestId('file-card')).toBeInTheDocument()
    const grid = view.getByTestId('all-notes-grid').element()
    const columns = [...grid.children].map((column) => column.textContent ?? '')
    // Newest first, row by row: New, then the file, then Log.
    expect(columns[0]).toContain('New')
    expect(columns[1]).toContain('deck.pdf')
    expect(columns[2]).toContain('Log')
    await view.unmount()
  })
})
