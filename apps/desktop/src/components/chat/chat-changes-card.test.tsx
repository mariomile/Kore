import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@/routing/router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@/hooks/use-note-row', () => ({
  useNoteRow: (path: string) => (path === 'notes/project-x.md' ? { title: 'Project X' } : null),
}))
const historyDialog = vi.hoisted(() => vi.fn())
vi.mock('@/components/note-history-dialog', () => ({
  NoteHistoryDialog: (props: { path: string; open: boolean }) => {
    historyDialog(props)
    return null
  },
}))

const { ChatChangesCard } = await import('./chat-changes-card')

describe('ChatChangesCard', () => {
  it('lists touched notes by title (stem fallback) and opens them', async () => {
    const view = await render(
      <ChatChangesCard paths={['notes/project-x.md', 'daily/2026-08-20.md']} />,
    )
    await expect.element(view.getByText('Edited 2 notes')).toBeVisible()
    await expect.element(view.getByText('Project X')).toBeVisible()

    await view.getByText('2026-08-20').click()
    expect(navigate).toHaveBeenCalledWith({ kind: 'note', path: 'daily/2026-08-20.md' })
    await view.unmount()
  })

  it('opens the note’s version history for review and restore', async () => {
    const view = await render(<ChatChangesCard paths={['notes/project-x.md']} />)
    await expect.element(view.getByText('Edited 1 note')).toBeVisible()
    await view.getByRole('button', { name: 'History of Project X' }).click()
    await vi.waitFor(() => {
      expect(historyDialog).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'notes/project-x.md', open: true }),
      )
    })
    await view.unmount()
  })
})
