import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { setPlatformSurface } from '@/lib/platform-surface'
import { NoteEditor } from './note-editor'
import { BlockSwipeGestures } from './block-swipe'
import { SWIPE_COMMIT_PX } from './block-swipe-gestures'
import { currentBlockSelection } from './block-selection-store'

/**
 * The swipe wired to the live editor: right selects a block (Craft), left
 * completes a task or lifts a nested item, a hold selects too, and a scroll
 * is never taken.
 *
 * Synthesizing the gesture needs the `Touch`/`TouchEvent` constructors, so
 * this file's suite runs on the Chromium leg and skips on the WebKit one.
 * WebKit *defines* both globals and then throws `Illegal constructor` when you
 * call them, so a `typeof` probe reports a capability that is not there — the
 * only honest check is to construct one and see. The thresholds this file
 * exercises are pure and covered on every engine by
 * `block-swipe-gestures.test.ts`; what is engine-specific here is the event
 * plumbing, not the decision.
 */

const CAN_SYNTHESIZE_TOUCH = ((): boolean => {
  try {
    const probe = document.createElement('div')
    void new TouchEvent('touchstart', { touches: [new Touch({ identifier: 0, target: probe })] })
    return true
  } catch {
    return false
  }
})()

const BASE_LIST = '- first\n- second\n'
const NESTED_LIST = '- first\n  - second\n'
const TASK_LIST = '- [ ] first\n- second\n'

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

function swipe(
  target: Element,
  deltaX: number,
  deltaY: number,
  coordinateTarget: Element = target,
): void {
  const bounds = coordinateTarget.getBoundingClientRect()
  const startX = bounds.left + bounds.width / 2
  const startY = bounds.top + bounds.height / 2
  target.dispatchEvent(touchEventOn(target, 'touchstart', startX, startY))
  target.dispatchEvent(touchEventOn(target, 'touchmove', startX + deltaX / 2, startY + deltaY / 2))
  target.dispatchEvent(touchEventOn(target, 'touchmove', startX + deltaX, startY + deltaY))
  target.dispatchEvent(touchEventOn(target, 'touchend', startX + deltaX, startY + deltaY))
}

async function renderList(onChange: (markdown: string) => void, content = BASE_LIST) {
  const view = await render(
    <NoteEditor initialContent={content} onChange={onChange}>
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

describe.skipIf(!CAN_SYNTHESIZE_TOUCH)('BlockSwipeGestures', () => {
  it('selects the swiped block without editing, and a tap adds the next one', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange)
    onChange.mockClear()

    swipe(editable, SWIPE_COMMIT_PX + 20, 2, view.getByText('first').element())
    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(1)
    })
    expect(document.querySelectorAll('.kore-block-selected')).toHaveLength(1)
    // Selecting is view state: the note does not change, and nothing can type.
    expect(onChange).not.toHaveBeenCalled()
    expect(editable.getAttribute('contenteditable')).toBe('false')

    swipe(editable, 0, 0, view.getByText('second').element())
    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(2)
    })

    currentBlockSelection()?.commands.setKind('task')
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe('- [ ] first\n- [ ] second\n')
    })

    currentBlockSelection()?.commands.clear()
    await vi.waitFor(() => {
      expect(currentBlockSelection()).toBeNull()
    })
    expect(editable.getAttribute('contenteditable')).toBe('true')
  })

  it('selects a block held still, with the editor read-only during the hold', async () => {
    const { view, editable } = await renderList(vi.fn())
    const target = view.getByText('second').element()
    const bounds = target.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    const y = bounds.top + bounds.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(editable.getAttribute('contenteditable')).toBe('false')
    await new Promise((resolve) => setTimeout(resolve, 200))
    editable.dispatchEvent(touchEventOn(editable, 'touchend', x, y))
    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(1)
    })
    currentBlockSelection()?.commands.clear()
  })

  it('completes a task swiped left', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange, TASK_LIST)
    onChange.mockClear()

    swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('first').element())
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe('- [x] first\n- second\n')
    })
  })

  it('lifts a nested item swiped left, even with the caret elsewhere', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange, NESTED_LIST)
    await userEvent.click(view.getByText('first'))
    onChange.mockClear()

    swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('second').element())
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
