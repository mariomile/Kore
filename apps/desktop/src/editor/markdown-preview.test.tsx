import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { formatDateChip } from '@/lib/dates'
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

describe('MarkdownPreview date links', () => {
  it('draws a date link as the editor date chip when given a format', async () => {
    const view = await render(
      <MarkdownPreview
        content={'Call on [[2026-11-16]], see [[2026-11-17|Tuesday]] and [[Lisbon]]'}
        dateFormat="dmy"
      />,
    )
    const labels = () =>
      [...view.container.querySelectorAll('.md-wikilink-view-label')].map((label) => ({
        text: label.textContent,
        chip: label.classList.contains('kore-date-chip'),
      }))
    await expect.poll(labels).toEqual([
      { text: formatDateChip('2026-11-16', 'dmy'), chip: true },
      { text: 'Tuesday', chip: false },
      { text: 'Lisbon', chip: false },
    ])
  })

  it('keeps a callout whose title holds a date link', async () => {
    const view = await render(
      <MarkdownPreview content={'> [!note] Due [[2026-11-16]]\n> Body'} dateFormat="dmy" />,
    )
    const quote = view.container.querySelector('blockquote')!
    await expect
      .poll(() => quote.querySelector('.kore-date-chip')?.textContent)
      .toBe(formatDateChip('2026-11-16', 'dmy'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(quote).toHaveAttribute('data-callout', 'note')
  })
})
