import { render } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import { NoteAppearance } from './note-appearance'

function resolve(src: string): string | null {
  if (src.startsWith('assets/')) {
    return `resolved:${src}`
  }
  if (src.startsWith('http')) {
    return src
  }
  return null
}

describe('NoteAppearance', () => {
  it('renders an emoji icon from frontmatter', async () => {
    const view = await render(
      <NoteAppearance source={'---\nicon: ✨\n---\n'} resolveImageUrl={resolve} />,
    )
    const icon = view.getByTestId('note-icon').element()
    expect(icon.textContent).toBe('✨')
    expect(view.container.querySelector('[data-testid="note-cover"]')).toBeNull()
    await view.unmount()
  })

  it('renders a cover image from a wiki embed path', async () => {
    const view = await render(
      <NoteAppearance
        source={'---\ncover: "![[assets/hero.png]]"\n---\n'}
        resolveImageUrl={resolve}
      />,
    )
    const cover = view.getByTestId('note-cover').element()
    expect(cover.getAttribute('src')).toBe('resolved:assets/hero.png')
    await view.unmount()
  })

  it('renders nothing when the header has no appearance keys', async () => {
    const view = await render(
      <NoteAppearance source={'---\naliases:\n  - x\n---\n'} resolveImageUrl={resolve} />,
    )
    expect(view.container.querySelector('[data-testid="note-icon"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="note-cover"]')).toBeNull()
    await view.unmount()
  })
})
