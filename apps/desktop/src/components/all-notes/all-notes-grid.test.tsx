import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { NoteListEntry } from '@reflect/core'
import { AllNotesGrid } from './all-notes-grid'

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { dateFormat: 'mdy', timeFormat: '12h' },
  }),
}))
vi.mock('./note-card-preview', () => ({
  NoteCardPreview: () => (
    <div
      data-testid="note-card-preview"
      className="h-full max-h-56"
      style={{ minHeight: '14rem' }}
    />
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
    const preview = view.getByTestId('note-card-preview').element()
    const footer = view.getByText('company').element()
    const previewBox = preview.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    const footerBox = footer.getBoundingClientRect()
    expect(previewBox.bottom).toBeLessThanOrEqual(footerBox.top + 1)
    expect(previewBox.bottom).toBeLessThanOrEqual(cardBox.bottom + 1)
    expect(previewBox.left).toBeGreaterThanOrEqual(cardBox.left)
    expect(previewBox.right).toBeLessThanOrEqual(cardBox.right + 1)
    await view.unmount()
  })
})
