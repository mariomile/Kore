import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { MarkdownPreview } from './markdown-preview'

vi.mock('@/editor/open-external-link', () => ({
  useOpenExternalLink: () => vi.fn(),
}))

describe('MarkdownPreview callouts', () => {
  it('draws an Obsidian callout with its kind, title and default label', async () => {
    const view = await render(
      <MarkdownPreview content={'> [!tldr] In short\n> Body text\n\n> [!bug]\n> Crash'} />,
    )
    const quotes = view.container.querySelectorAll('blockquote')
    await expect.poll(() => quotes[0]?.getAttribute('data-callout')).toBe('abstract')
    expect(quotes[0]?.firstElementChild).toHaveTextContent(/^In short$/)
    expect(quotes[0]?.lastElementChild).toHaveTextContent('Body text')
    expect(quotes[1]).toHaveAttribute('data-callout', 'bug')
    expect(quotes[1]?.firstElementChild).toHaveTextContent(/^Bug$/)
  })

  it('folds a collapsed callout and opens it on a title click', async () => {
    const view = await render(<MarkdownPreview content={'> [!faq]- Why?\n> Because.'} />)
    const quote = view.container.querySelector('blockquote')!
    await expect.poll(() => quote.hasAttribute('data-callout-folded')).toBe(true)
    ;(quote.firstElementChild as HTMLElement).click()
    expect(quote.hasAttribute('data-callout-folded')).toBe(false)
  })

  it('leaves the fold alone when a wiki link in the title is clicked', async () => {
    const view = await render(<MarkdownPreview content={'> [!faq]- See [[Roadmap]]\n> Because.'} />)
    const quote = view.container.querySelector('blockquote')!
    await expect.poll(() => quote.hasAttribute('data-callout-folded')).toBe(true)
    const chip = quote.querySelector<HTMLElement>('.md-wikilink-view')
    expect(chip).not.toBeNull()
    chip!.click()
    expect(quote.hasAttribute('data-callout-folded')).toBe(true)
  })

  it('shows a collapsed callout open in a passive preview', async () => {
    const view = await render(
      <MarkdownPreview content={'> [!faq]- Why?\n> Because.'} interactive={false} />,
    )
    const quote = view.container.querySelector('blockquote')!
    await expect.poll(() => quote.getAttribute('data-callout-fold')).toBe('none')
    expect(quote.hasAttribute('data-callout-folded')).toBe(false)
  })
})
