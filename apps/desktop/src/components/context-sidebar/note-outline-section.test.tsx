import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteOutlineSection } from './note-outline-section'

/**
 * The outline reads the rendered document, so these tests build the surface
 * the editor produces — a `.ProseMirror` root under `.reflect-note-surface` —
 * rather than mocking a hook. That is the contract worth pinning: headings
 * nested in a blockquote or a list are quoted prose, not sections, and only
 * direct children of the root count.
 */
let surface: HTMLDivElement | null = null

function mountSurface(html: string): HTMLElement {
  surface = document.createElement('div')
  surface.className = 'reflect-note-surface'
  surface.innerHTML = `<div class="ProseMirror">${html}</div>`
  document.body.append(surface)
  return surface
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  surface?.remove()
  surface = null
})

describe('NoteOutlineSection', () => {
  it('renders nothing for a note with no headings', async () => {
    mountSurface('<p>Just prose.</p>')
    await render(<NoteOutlineSection />)
    expect(page.getByText('Outline').elements()).toHaveLength(0)
  })

  it('lists the document headings in order', async () => {
    mountSurface('<h1>Alpha</h1><p>x</p><h2>Beta</h2><h3>Gamma</h3>')
    await render(<NoteOutlineSection />)

    await expect.element(page.getByText('Outline')).toBeInTheDocument()
    const items = page.getByRole('button').elements().slice(1) // [0] is the section header
    expect(items.map((item) => item.textContent)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('ignores headings nested in quoted prose', async () => {
    // `> ## Meetings` is a quotation, not a section of this note — the same
    // rule `topLevelHeadings` applies to the parsed model.
    mountSurface(
      '<h2>Real</h2><blockquote><h2>Quoted</h2></blockquote><ul><li><h3>Listed</h3></li></ul>',
    )
    await render(<NoteOutlineSection />)

    await expect.element(page.getByRole('button', { name: 'Real' })).toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Quoted' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Listed' }).elements()).toHaveLength(0)
  })

  it('indents relative to the shallowest heading present', async () => {
    // A note whose top level is `##` must not render every entry inset.
    mountSurface('<h2>Top</h2><h3>Under</h3>')
    await render(<NoteOutlineSection />)

    const top = page.getByRole('button', { name: 'Top' }).element() as HTMLElement
    const under = page.getByRole('button', { name: 'Under' }).element() as HTMLElement
    expect(top.style.paddingLeft).toBe('0.5rem')
    expect(under.style.paddingLeft).toBe('1.25rem')
  })

  it('scrolls the clicked heading into view', async () => {
    mountSurface('<h1>Alpha</h1><h2>Beta</h2>')
    const scrollIntoView = vi.fn()
    const beta = document.querySelector('.ProseMirror > h2') as HTMLElement
    beta.scrollIntoView = scrollIntoView
    await render(<NoteOutlineSection />)

    await userEvent.click(page.getByRole('button', { name: 'Beta' }))
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('follows the document as headings change', async () => {
    const mounted = mountSurface('<h1>Alpha</h1>')
    await render(<NoteOutlineSection />)
    await expect.element(page.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()

    mounted.querySelector('.ProseMirror')?.insertAdjacentHTML('beforeend', '<h2>Beta</h2>')
    await expect.element(page.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
  })

  it('labels a heading with no text rather than rendering a blank row', async () => {
    mountSurface('<h1></h1>')
    await render(<NoteOutlineSection />)
    await expect.element(page.getByRole('button', { name: 'Untitled heading' })).toBeInTheDocument()
  })
})
