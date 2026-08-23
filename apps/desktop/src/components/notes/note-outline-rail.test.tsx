import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteOutlineRail } from './note-outline-rail'

/**
 * Like the sidebar outline section, the rail reads the rendered document, so
 * these tests build the surface the editor produces — a `.ProseMirror` root
 * under `.reflect-note-surface` — rather than mocking a hook.
 */
let surface: HTMLDivElement | null = null

function mountSurface(html: string): HTMLElement {
  surface = document.createElement('div')
  surface.className = 'reflect-note-surface'
  surface.innerHTML = `<div class="ProseMirror">${html}</div>`
  document.body.append(surface)
  return surface
}

afterEach(() => {
  surface?.remove()
  surface = null
})

describe('NoteOutlineRail', () => {
  it('renders nothing for a note with no headings', async () => {
    mountSurface('<p>Just prose.</p>')
    await render(<NoteOutlineRail />)
    expect(page.getByRole('navigation', { name: 'Note outline' }).elements()).toHaveLength(0)
  })

  it('lists the document headings as jump entries once opened', async () => {
    mountSurface('<h1>Alpha</h1><p>x</p><h2>Beta</h2><h3>Gamma</h3>')
    await render(<NoteOutlineRail />)

    await userEvent.hover(page.getByTestId('note-outline-rail'))

    const nav = page.getByRole('navigation', { name: 'Note outline' })
    const items = nav.getByRole('button').elements()
    expect(items.map((item) => item.textContent)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('draws one collapsed dash per heading, longer for shallower levels', async () => {
    mountSurface('<h1>Alpha</h1><h2>Beta</h2>')
    await render(<NoteOutlineRail />)
    const toggle = page.getByRole('button', { name: 'Show note outline' })
    await expect.element(toggle).toBeInTheDocument()

    const dashes = [...toggle.element().querySelectorAll<HTMLElement>('span')]
    expect(dashes).toHaveLength(2)
    expect(dashes[0]?.style.width).toBe('1.25rem')
    expect(dashes[1]?.style.width).toBe('1rem')
  })

  it('scrolls the clicked heading into view', async () => {
    mountSurface('<h1>Alpha</h1><h2>Beta</h2>')
    const scrollIntoView = vi.fn()
    const beta = document.querySelector('.ProseMirror > h2') as HTMLElement
    beta.scrollIntoView = scrollIntoView
    await render(<NoteOutlineRail />)

    // The jump list only exists while the rail is hovered or focused — aim
    // at the collapsed dashes first, the way a reader reaches it.
    await userEvent.hover(page.getByTestId('note-outline-rail'))
    await userEvent.click(page.getByRole('button', { name: 'Beta' }))
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('follows the document as headings change', async () => {
    const mounted = mountSurface('<h1>Alpha</h1>')
    await render(<NoteOutlineRail />)
    await userEvent.hover(page.getByTestId('note-outline-rail'))
    await expect.element(page.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()

    mounted.querySelector('.ProseMirror')?.insertAdjacentHTML('beforeend', '<h2>Beta</h2>')
    await expect.element(page.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
  })
})
