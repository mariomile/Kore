import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
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

  it('adds an icon from the picker when the header is editable', async () => {
    const onIconChange = vi.fn()
    const view = await render(
      <NoteAppearance source={''} resolveImageUrl={resolve} onIconChange={onIconChange} />,
    )
    await view.getByRole('button', { name: 'Add icon' }).click()
    await view.getByRole('button', { name: '🚀' }).click()
    expect(onIconChange).toHaveBeenCalledWith('🚀')
    await view.unmount()
  })

  it('removes an existing icon through the same picker', async () => {
    const onIconChange = vi.fn()
    const view = await render(
      <NoteAppearance
        source={'---\nicon: ✨\n---\n'}
        resolveImageUrl={resolve}
        onIconChange={onIconChange}
      />,
    )
    await view.getByRole('button', { name: 'Change icon' }).click()
    await view.getByRole('button', { name: 'Remove icon' }).click()
    expect(onIconChange).toHaveBeenCalledWith(null)
    await view.unmount()
  })
})
