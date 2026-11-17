import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

const navigate = vi.fn()
vi.mock('@/hooks/use-note-link-navigation', () => ({ useNoteLinkNavigation: () => navigate }))

const { ChatContextSources } = await import('./chat-context-sources')

const NOTES = [
  { path: 'notes/alpha.md', title: 'Alpha', excerpt: 'A recalled fact', source: 'recall' as const },
  { path: 'beta.md', title: 'Beta', excerpt: 'An explicit reference', source: 'mention' as const },
]

it('starts as one collapsed pill and lists the notes on demand', async () => {
  const view = await render(<ChatContextSources notes={NOTES} />)
  const pill = view.getByRole('button', { name: 'Used 2 notes' })
  await expect.element(pill).toHaveAttribute('aria-expanded', 'false')
  await expect
    .element(view.getByRole('button', { name: /Open note Alpha/i }))
    .not.toBeInTheDocument()

  await pill.click()
  await expect.element(pill).toHaveAttribute('aria-expanded', 'true')
  const alpha = view.getByRole('button', { name: /Open note Alpha/i })
  await expect.element(alpha).toBeVisible()
  // The excerpt stays inspectable as the row's tooltip, never as body text.
  await expect.element(alpha).toHaveAttribute('title', 'A recalled fact')
  await expect.element(view.getByText('A recalled fact')).not.toBeInTheDocument()
  await expect.element(view.getByText('notes', { exact: true })).toBeVisible()
  await expect.element(view.getByText('Mentioned', { exact: true })).toBeVisible()

  await alpha.click()
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ openInSplit: false }))
  await view.unmount()
})

it('says note in the singular', async () => {
  const view = await render(<ChatContextSources notes={NOTES.slice(0, 1)} />)
  await expect.element(view.getByRole('button', { name: 'Used 1 note' })).toBeVisible()
  await view.unmount()
})
