import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { NoteAppearance } from './note-appearance'
import { dragCoverPosition } from './note-cover'

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

  it('sets the cover from an https image link', async () => {
    const onCoverChange = vi.fn()
    const view = await render(
      <NoteAppearance
        source={''}
        resolveImageUrl={resolve}
        onCoverChange={onCoverChange}
        uploadCover={vi.fn()}
      />,
    )
    await view.getByRole('button', { name: 'Add cover' }).click()
    await userEvent.fill(view.getByLabelText('Cover image link'), 'https://example.com/hero.jpg')
    await view.getByRole('button', { name: 'Use link' }).click()
    expect(onCoverChange).toHaveBeenCalledWith('https://example.com/hero.jpg')
    await view.unmount()
  })

  it('refuses a cover link that is not https', async () => {
    const onCoverChange = vi.fn()
    const view = await render(
      <NoteAppearance
        source={''}
        resolveImageUrl={resolve}
        onCoverChange={onCoverChange}
        uploadCover={vi.fn()}
      />,
    )
    await view.getByRole('button', { name: 'Add cover' }).click()
    await userEvent.fill(view.getByLabelText('Cover image link'), 'http://example.com/hero.jpg')
    await view.getByRole('button', { name: 'Use link' }).click()
    await expect.element(view.getByRole('alert')).toHaveTextContent('https')
    expect(onCoverChange).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('uploads an image dropped on the cover panel and uses its vault path', async () => {
    const onCoverChange = vi.fn()
    const uploadCover = vi.fn(async () => 'assets/pasted-1.png')
    const view = await render(
      <NoteAppearance
        source={''}
        resolveImageUrl={resolve}
        onCoverChange={onCoverChange}
        uploadCover={uploadCover}
      />,
    )
    await view.getByRole('button', { name: 'Add cover' }).click()
    const zone = view.getByTestId('cover-drop-zone').element()
    const image = new File(['png'], 'hero.png', { type: 'image/png' })
    dropFiles(zone, [new File(['txt'], 'notes.txt', { type: 'text/plain' }), image])
    await vi.waitFor(() => expect(onCoverChange).toHaveBeenCalledWith('assets/pasted-1.png'))
    expect(uploadCover).toHaveBeenCalledWith(image)
    await view.unmount()
  })

  it('replaces the cover with an image dropped on it', async () => {
    const onCoverChange = vi.fn()
    const view = await render(
      <NoteAppearance
        source={'---\ncover: assets/old.png\n---\n'}
        resolveImageUrl={resolve}
        onCoverChange={onCoverChange}
        uploadCover={async () => 'assets/new.png'}
      />,
    )
    const cover = view.getByTestId('note-cover').element()
    dropFiles(cover, [new File(['png'], 'new.png', { type: 'image/png' })])
    await vi.waitFor(() => expect(onCoverChange).toHaveBeenCalledWith('assets/new.png'))
    await view.unmount()
  })

  it('removes the cover', async () => {
    const onCoverChange = vi.fn()
    const view = await render(
      <NoteAppearance
        source={'---\ncover: assets/old.png\n---\n'}
        resolveImageUrl={resolve}
        onCoverChange={onCoverChange}
        uploadCover={vi.fn()}
      />,
    )
    expect(view.container.querySelector('[aria-label="Add cover"]')).toBeNull()
    await view.getByRole('button', { name: 'Remove cover' }).click()
    expect(onCoverChange).toHaveBeenCalledWith(null)
    await view.unmount()
  })

  it('shows no cover controls when the header is read-only', async () => {
    const view = await render(
      <NoteAppearance source={'---\ncover: assets/old.png\n---\n'} resolveImageUrl={resolve} />,
    )
    expect(view.container.querySelector('[aria-label="Remove cover"]')).toBeNull()
    expect(view.container.querySelector('[aria-label="Change cover"]')).toBeNull()
    await view.unmount()
  })
})

/** A data-URL image taller than wide, so a full-width cover crops it vertically. */
function tallImage(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 160
  const context = canvas.getContext('2d')
  if (context !== null) {
    context.fillStyle = '#336699'
    context.fillRect(0, 0, 40, 160)
  }
  return canvas.toDataURL('image/png')
}

describe('cover position', () => {
  it('crops the cover at the saved cover_y', async () => {
    const view = await render(
      <NoteAppearance
        source={'---\ncover: assets/old.png\ncover_y: 20\n---\n'}
        resolveImageUrl={resolve}
      />,
    )
    const cover = view.getByTestId('note-cover').element() as HTMLImageElement
    expect(cover.style.objectPosition).toBe('50% 20%')
    await view.unmount()
  })

  it('moves the cover with the arrow keys and saves only on Save position', async () => {
    const onCoverPositionChange = vi.fn()
    const url = tallImage()
    const view = await render(
      <NoteAppearance
        source={'---\ncover: assets/tall.png\n---\n'}
        resolveImageUrl={() => url}
        onCoverChange={vi.fn()}
        uploadCover={vi.fn()}
        onCoverPositionChange={onCoverPositionChange}
      />,
    )
    await view.getByRole('button', { name: 'Reposition cover' }).click()
    const image = view.getByLabelText('Cover position')
    await expect.element(image).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect((image.element() as HTMLImageElement).style.objectPosition).toBe('50% 60%')
    expect(onCoverPositionChange).not.toHaveBeenCalled()
    await view.getByRole('button', { name: 'Save position' }).click()
    expect(onCoverPositionChange).toHaveBeenCalledWith(60)
    await view.unmount()
  })

  it('drops the draft position on Cancel', async () => {
    const onCoverPositionChange = vi.fn()
    const url = tallImage()
    const view = await render(
      <NoteAppearance
        source={'---\ncover: assets/tall.png\ncover_y: 30\n---\n'}
        resolveImageUrl={() => url}
        onCoverChange={vi.fn()}
        uploadCover={vi.fn()}
        onCoverPositionChange={onCoverPositionChange}
      />,
    )
    await view.getByRole('button', { name: 'Reposition cover' }).click()
    await userEvent.keyboard('{ArrowUp}')
    await view.getByRole('button', { name: 'Cancel' }).click()
    const cover = view.getByTestId('note-cover').element() as HTMLImageElement
    expect(cover.style.objectPosition).toBe('50% 30%')
    expect(onCoverPositionChange).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('offers no Reposition for a cover too wide to crop', async () => {
    const view = await render(
      <NoteAppearance
        source={'---\ncover: assets/old.png\n---\n'}
        resolveImageUrl={resolve}
        onCoverChange={vi.fn()}
        uploadCover={vi.fn()}
        onCoverPositionChange={vi.fn()}
      />,
    )
    await expect.element(view.getByRole('button', { name: 'Remove cover' })).toBeInTheDocument()
    expect(view.container.querySelector('[aria-label="Reposition cover"]')).toBeNull()
    await view.unmount()
  })

  it('maps a vertical drag onto the position, keeping the image under the pointer', () => {
    expect(dragCoverPosition(50, 0, 200)).toBe(50)
    // Dragging down reveals more of the top.
    expect(dragCoverPosition(50, 100, 200)).toBe(0)
    expect(dragCoverPosition(50, -50, 200)).toBe(75)
    expect(dragCoverPosition(10, 400, 200)).toBe(0)
    expect(dragCoverPosition(90, -400, 200)).toBe(100)
    expect(dragCoverPosition(40, 80, 0)).toBe(40)
  })
})

function dropFiles(target: Element, files: File[]): void {
  const data = new DataTransfer()
  for (const file of files) {
    data.items.add(file)
  }
  target.dispatchEvent(
    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }),
  )
  target.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
  )
}
