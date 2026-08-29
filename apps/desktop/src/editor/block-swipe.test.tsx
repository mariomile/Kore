import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { setPlatformSurface } from '@/lib/platform-surface'
import { NoteEditor } from './note-editor'
import { BlockSwipeGestures } from './block-swipe'
import { SWIPE_COMMIT_PX } from './block-swipe-gestures'

/**
 * The swipe wired to the live editor: it must move a list item, and it must
 * not take a gesture that was a scroll.
 */

const BASE_LIST = '- first\n- second\n'

function touchEventOn(
  target: Element,
  type: 'touchstart' | 'touchmove' | 'touchend',
  x: number,
  y: number,
): TouchEvent {
  const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y })
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: type !== 'touchstart',
    touches: type === 'touchend' ? [] : [touch],
    changedTouches: [touch],
  })
}

function swipe(target: Element, deltaX: number, deltaY: number): void {
  target.dispatchEvent(touchEventOn(target, 'touchstart', 100, 200))
  target.dispatchEvent(touchEventOn(target, 'touchmove', 100 + deltaX / 2, 200 + deltaY / 2))
  target.dispatchEvent(touchEventOn(target, 'touchmove', 100 + deltaX, 200 + deltaY))
  target.dispatchEvent(touchEventOn(target, 'touchend', 100 + deltaX, 200 + deltaY))
}

async function renderList(onChange: (markdown: string) => void) {
  const view = await render(
    <NoteEditor initialContent={BASE_LIST} onChange={onChange}>
      <BlockSwipeGestures />
    </NoteEditor>,
  )
  const editable = document.querySelector('[contenteditable="true"]')
  if (editable === null) {
    throw new Error('editor did not mount')
  }
  return { view, editable }
}

beforeEach(() => {
  setPlatformSurface({ touchEditor: true })
})

afterEach(() => {
  setPlatformSurface({ touchEditor: false })
})

describe('BlockSwipeGestures', () => {
  it('nests the caret’s list item on a rightward swipe and lifts it back', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange)

    // Click into the second item so the command acts where the finger was.
    await userEvent.click(view.getByText('second'))
    onChange.mockClear()

    swipe(editable, SWIPE_COMMIT_PX + 20, 2)
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
    const indented = onChange.mock.calls.at(-1)?.[0] ?? ''
    expect(indented).not.toBe(BASE_LIST)
    expect(indented).toContain('second')

    onChange.mockClear()
    swipe(editable, -(SWIPE_COMMIT_PX + 20), 2)
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(BASE_LIST)
    })
  })

  it('leaves a scroll alone', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { editable } = await renderList(onChange)
    onChange.mockClear()

    swipe(editable, 60, 120)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(onChange).not.toHaveBeenCalled()
  })
})
