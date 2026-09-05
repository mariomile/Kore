import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('@/hooks/use-note-row', () => ({ useNoteRow: () => null }))
vi.mock('@/hooks/use-note-link-navigation', () => ({ useNoteLinkNavigation: () => vi.fn() }))

const { ChatContextSources } = await import('./chat-context-sources')

it('discloses persisted recall and mention excerpts on demand', async () => {
  const view = await render(
    <ChatContextSources
      notes={[
        { path: 'notes/alpha.md', title: 'Alpha', excerpt: 'A recalled fact', source: 'recall' },
        {
          path: 'notes/beta.md',
          title: 'Beta',
          excerpt: 'An explicit reference',
          source: 'mention',
        },
      ]}
    />,
  )
  await expect.element(view.getByText('A recalled fact')).not.toBeVisible()
  await view.getByText('Context used · 2 notes').click()
  await expect.element(view.getByText('A recalled fact')).toBeVisible()
  await expect.element(view.getByText('Mentioned by you')).toBeVisible()
  await expect.element(view.getByRole('button', { name: /Open note alpha/i })).toBeVisible()
  await view.unmount()
})
