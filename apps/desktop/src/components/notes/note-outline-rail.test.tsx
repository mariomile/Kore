import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishKeyboardHeight } from '@/mobile/use-keyboard'
import { NoteOutlineRail } from './note-outline-rail'

/**
 * Like the sidebar outline section, the rail reads the rendered document, so
 * these tests build the surface the editor produces — a `.ProseMirror` root
 * under `.kore-note-surface`, inside the view the rail is scoped to — rather
 * than mocking a hook.
 */
const views: HTMLDivElement[] = []

function mountView(html: string): { current: HTMLDivElement } {
  const view = document.createElement('div')
  view.innerHTML = `<div class="kore-note-surface"><div class="ProseMirror">${html}</div></div>`
  document.body.append(view)
  views.push(view)
  return { current: view }
}

/**
 * A tap, not a mouse click: the mouse would hover the rail open first, and
 * the jump list then covers the dashes it was aiming at.
 */
function tap(element: Element): void {
  if (element instanceof HTMLElement) {
    element.click()
  }
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.remove()
  }
  publishKeyboardHeight(0)
})

describe('NoteOutlineRail', () => {
  it('renders nothing for a note with no sections', async () => {
    const scope = mountView('<h1>Only a title</h1><p>Just prose.</p>')
    await render(<NoteOutlineRail scope={scope} />)
    expect(page.getByRole('button', { name: 'Show note outline' }).elements()).toHaveLength(0)
  })

  it('lists the section headings, without the title, once opened', async () => {
    const scope = mountView('<h1>Title</h1><h2>Alpha</h2><p>x</p><h2>Beta</h2><h3>Gamma</h3>')
    await render(<NoteOutlineRail scope={scope} />)

    await userEvent.hover(page.getByTestId('note-outline-rail'))

    const nav = page.getByRole('navigation', { name: 'Note outline' })
    const items = nav.getByRole('button').elements()
    expect(items.map((item) => item.textContent)).toEqual(['Alpha', 'Beta', 'Gamma'])

    // Leaving folds it again — and frees the pointer for the next test.
    await userEvent.unhover(page.getByTestId('note-outline-rail'))
    await expect.element(nav).not.toBeInTheDocument()
  })

  it('lists only the headings of its own view', async () => {
    // A split pane (or a pushed iPhone screen) keeps another note in the DOM.
    mountView('<h2>Other pane</h2>')
    const scope = mountView('<h2>Mine</h2>')
    await render(<NoteOutlineRail scope={scope} />)

    tap(page.getByRole('button', { name: 'Show note outline' }).element())
    await expect.element(page.getByRole('button', { name: 'Mine' })).toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Other pane' }).elements()).toHaveLength(0)
  })

  it('scrolls the picked heading into view and folds the list', async () => {
    const scope = mountView('<h2>Alpha</h2><h2>Beta</h2>')
    const scrollIntoView = vi.fn()
    const beta = scope.current.querySelector('.ProseMirror > h2:last-child') as HTMLElement
    beta.scrollIntoView = scrollIntoView
    await render(<NoteOutlineRail scope={scope} />)

    // The jump list only exists once opened — a tap on the dashes, the way
    // a reader on the phone reaches it.
    tap(page.getByRole('button', { name: 'Show note outline' }).element())
    await userEvent.click(page.getByRole('button', { name: 'Beta' }))
    expect(scrollIntoView).toHaveBeenCalled()
    await expect
      .element(page.getByRole('navigation', { name: 'Note outline' }))
      .not.toBeInTheDocument()
  })

  it('steps aside while the software keyboard is up', async () => {
    const scope = mountView('<h2>Alpha</h2>')
    await render(<NoteOutlineRail scope={scope} />)
    await expect.element(page.getByRole('button', { name: 'Show note outline' })).toBeVisible()

    publishKeyboardHeight(320)
    await expect
      .element(page.getByRole('button', { name: 'Show note outline' }))
      .not.toBeInTheDocument()
  })

  it('follows the document as headings change', async () => {
    const scope = mountView('<h2>Alpha</h2>')
    await render(<NoteOutlineRail scope={scope} />)
    tap(page.getByRole('button', { name: 'Show note outline' }).element())
    await expect.element(page.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()

    scope.current.querySelector('.ProseMirror')?.insertAdjacentHTML('beforeend', '<h2>Beta</h2>')
    await expect.element(page.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
  })
})
