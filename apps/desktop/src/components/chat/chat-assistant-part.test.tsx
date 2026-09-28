import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ChatAssistantPart } from './chat-assistant-part'

vi.mock('@/editor/open-external-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor/open-external-link')>()),
  useOpenExternalLink: () => undefined,
}))

it('formats a growing reply before completion and keeps note links navigable', async () => {
  const navigate = vi.fn()
  const view = await render(
    <ChatAssistantPart
      part={{ kind: 'text', text: '**Fatto:**' }}
      status="streaming"
      onWikiLinkClick={navigate}
    />,
  )

  await vi.waitFor(() => {
    expect(view.container.querySelector('strong')?.textContent).toContain('Fatto:')
  })

  const reply = '**Fatto:**\n\n- Apri [[Atlas]].\n- Controlla il risultato.'
  await view.rerender(
    <ChatAssistantPart
      part={{ kind: 'text', text: reply }}
      status="streaming"
      onWikiLinkClick={navigate}
    />,
  )
  await vi.waitFor(() => {
    expect(view.container.querySelectorAll('[data-list-kind="bullet"]')).toHaveLength(2)
  })
  await view.getByText('Atlas', { exact: true }).click()
  expect(navigate).toHaveBeenCalledWith({ target: 'Atlas', openInSplit: false })
  for (const delimiter of view.container.querySelectorAll('.md-mark')) {
    expect(delimiter.getBoundingClientRect().width).toBe(0)
  }

  await view.rerender(
    <ChatAssistantPart
      part={{ kind: 'text', text: reply }}
      status="done"
      onWikiLinkClick={navigate}
    />,
  )
  expect(view.container.querySelector('strong')?.textContent).toContain('Fatto:')
  expect(view.container.querySelectorAll('[data-list-kind="bullet"]')).toHaveLength(2)
})
