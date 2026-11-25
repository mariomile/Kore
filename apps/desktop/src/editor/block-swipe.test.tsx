import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { setPlatformSurface } from '@/lib/platform-surface'
import { NoteEditor } from './note-editor'
import { BlockSwipeGestures } from './block-swipe'
import { SWIPE_COMMIT_PX } from './block-swipe-gestures'
import { currentBlockSelection } from './block-selection-store'
import { PageBlocks } from './page-blocks'
import { BlockZoom } from './block-zoom'
import { hapticImpactLight } from '@/mobile/haptics'

vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: vi.fn() }))

/**
 * The swipe wired to the live editor: left selects a block, right completes
 * a task or nests an item under the one above, a hold selects too, and a scroll
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

async function renderList(onChange: (markdown: string) => void, content = BASE_LIST, zoom = false) {
  const view = await render(
    <NoteEditor initialContent={content} onChange={onChange}>
      {zoom ? <BlockZoom /> : null}
      <BlockSwipeGestures />
      <PageBlocks />
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

    swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('first').element())
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

  it('selects every block a leftward sweep crosses', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange)
    onChange.mockClear()

    const first = view.getByText('first').element().getBoundingClientRect()
    const second = view.getByText('second').element().getBoundingClientRect()
    // Start in the empty right end of the line, so the sweep stays over text.
    const x = editable.getBoundingClientRect().right - 20
    const y = first.top + first.height / 2
    const secondY = second.top + second.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 30, y + 2))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 50, y + 2))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 50, secondY))
    editable.dispatchEvent(touchEventOn(editable, 'touchend', x - 50, secondY))

    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(2)
    })
    expect(onChange).not.toHaveBeenCalled()
    currentBlockSelection()?.commands.clear()
  })

  it('shows the block selected as the swipe commits, and lets go if it comes back', async () => {
    const { view, editable } = await renderList(vi.fn())
    vi.mocked(hapticImpactLight).mockClear()
    const first = view.getByText('first').element().getBoundingClientRect()
    const x = editable.getBoundingClientRect().right - 20
    const y = first.top + first.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 20, y))
    expect(currentBlockSelection()).toBeNull()
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - (SWIPE_COMMIT_PX + 6), y))
    // Selected while the finger is still down; the action bar gives the tick.
    expect(currentBlockSelection()?.state.count).toBe(1)
    expect(hapticImpactLight).not.toHaveBeenCalled()
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 10, y))
    expect(currentBlockSelection()).toBeNull()
    editable.dispatchEvent(touchEventOn(editable, 'touchend', x - 10, y))
    expect(currentBlockSelection()).toBeNull()
  })

  it('keeps a drifting swipe to its own block', async () => {
    const { view, editable } = await renderList(vi.fn())
    const first = view.getByText('first').element().getBoundingClientRect()
    const x = editable.getBoundingClientRect().right - 20
    const y = first.top + first.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 20, y + 4))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x - 60, y + 20))
    editable.dispatchEvent(touchEventOn(editable, 'touchend', x - 60, y + 20))
    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(1)
    })
    expect(document.querySelector('.kore-block-selected')?.textContent).toBe('first')
    currentBlockSelection()?.commands.clear()
  })

  it('leaves a drag the page is already scrolling', async () => {
    const { view, editable } = await renderList(vi.fn())
    const first = view.getByText('first').element().getBoundingClientRect()
    const x = editable.getBoundingClientRect().right - 20
    const y = first.top + first.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    const touch = new Touch({ identifier: 1, target: editable, clientX: x - 60, clientY: y })
    // iOS stops letting a touchmove cancel once its own scroll has begun.
    const scrolling = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: false,
      touches: [touch],
      changedTouches: [touch],
    })
    editable.dispatchEvent(scrolling)
    editable.dispatchEvent(touchEventOn(editable, 'touchend', x - 60, y))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(currentBlockSelection()).toBeNull()
  })

  it('never lets the browser start its own drag of selected blocks', async () => {
    const { view, editable } = await renderList(vi.fn())
    swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('first').element())
    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(1)
    })
    const dragStart = new DragEvent('dragstart', { bubbles: true, cancelable: true })
    view.getByText('first').element().dispatchEvent(dragStart)
    expect(dragStart.defaultPrevented).toBe(true)
    currentBlockSelection()?.commands.clear()
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

  it('drags a held block to another place in the note', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange, 'intro\n\n- first\n- second\n')
    onChange.mockClear()
    vi.mocked(hapticImpactLight).mockClear()
    const intro = view.getByText('intro').element().getBoundingClientRect()
    const second = view.getByText('second').element().getBoundingClientRect()
    const x = intro.left + 20
    const y = intro.top + intro.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    await new Promise((resolve) => setTimeout(resolve, 450))
    // Held, then moved: the paragraph lifts and the list closes up over the
    // place it left, which opens its landing place under "second".
    const move = touchEventOn(editable, 'touchmove', x, second.bottom - 2)
    editable.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(true)
    const firstItem = view.getByText('first').element().closest('.prosemirror-flat-list')
    expect(firstItem?.getAnimations()).toHaveLength(1)
    // One tick for the lift, one for the place that opened.
    expect(hapticImpactLight).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()

    editable.dispatchEvent(touchEventOn(editable, 'touchend', x, second.bottom - 2))
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe('- first\n- second\n\nintro\n')
    })
    // It lands still selected.
    expect(currentBlockSelection()?.state.count).toBe(1)
    expect(document.querySelector('.kore-block-selected')?.textContent).toBe('intro')
    currentBlockSelection()?.commands.clear()
  })

  it('settles a held block back when it is let go where it was', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange)
    onChange.mockClear()
    const first = view.getByText('first').element().getBoundingClientRect()
    const x = first.left + 20
    const y = first.top + first.height / 2
    editable.dispatchEvent(touchEventOn(editable, 'touchstart', x, y))
    await new Promise((resolve) => setTimeout(resolve, 450))
    editable.dispatchEvent(touchEventOn(editable, 'touchmove', x, y + 8))
    // Still over its own place: nothing around it makes room.
    const secondItem = view.getByText('second').element().closest('.prosemirror-flat-list')
    expect(secondItem?.getAnimations()).toHaveLength(0)
    editable.dispatchEvent(touchEventOn(editable, 'touchend', x, y + 8))
    expect(onChange).not.toHaveBeenCalled()
    expect(currentBlockSelection()?.state.count).toBe(1)
    currentBlockSelection()?.commands.clear()
  })

  it('steps any selected block with the arrows, a paragraph included', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange, 'intro\n\n- first\n- second\n')
    onChange.mockClear()
    swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('intro').element())
    await vi.waitFor(() => {
      expect(currentBlockSelection()?.state.count).toBe(1)
    })
    expect(currentBlockSelection()?.state.canMoveUp).toBe(false)
    expect(currentBlockSelection()?.state.canMoveDown).toBe(true)
    currentBlockSelection()?.commands.moveDown()
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe('- first\n\nintro\n\n- second\n')
    })
    expect(currentBlockSelection()?.state.count).toBe(1)
    currentBlockSelection()?.commands.clear()
  })

  it('completes a task swiped right', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange, TASK_LIST)
    onChange.mockClear()

    swipe(editable, SWIPE_COMMIT_PX + 20, 2, view.getByText('first').element())
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe('- [x] first\n- second\n')
    })
  })

  it('nests an item swiped right under the one above, even with the caret elsewhere', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { view, editable } = await renderList(onChange, BASE_LIST)
    await userEvent.click(view.getByText('first'))
    onChange.mockClear()

    swipe(editable, SWIPE_COMMIT_PX + 20, 2, view.getByText('second').element())
    await vi.waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(NESTED_LIST)
    })
    expect(currentBlockSelection()).toBeNull()
  })

  it('leaves a scroll alone', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const { editable } = await renderList(onChange)
    onChange.mockClear()

    swipe(editable, 60, 120)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(onChange).not.toHaveBeenCalled()
  })

  describe('sub pages', () => {
    const PAGE = '- Trip ^page-a1b2c3\n  - flight\n- after\n'

    async function selectPage(onChange: (markdown: string) => void) {
      const { editable } = await renderList(onChange, PAGE)
      const card = await vi.waitFor(() => {
        const found = document.querySelector('.kore-page-card')
        expect(found).not.toBeNull()
        return found!
      })
      swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, card)
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.isPage).toBe(true)
      })
    }

    it('turns a block into a page that keeps its children', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      const { view, editable } = await renderList(onChange, '- Trip\n  - flight\n- after\n')
      swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('Trip').element())
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.isPage).toBe(false)
      })
      currentBlockSelection()?.commands.makePage()
      await vi.waitFor(() => {
        expect(onChange.mock.calls.at(-1)?.[0]).toMatch(
          /^- Trip \^page-[\da-z]{6}\n {2}- flight\n- after\n$/,
        )
      })
      expect(currentBlockSelection()).toBeNull()
      await vi.waitFor(() => {
        expect(document.querySelector('.kore-page-card-title')?.textContent).toBe('Trip')
      })
    })

    it('leaves a line other notes may link to as a block', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      const { view, editable } = await renderList(onChange, '- Trip ^a1b2\n')
      onChange.mockClear()
      swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('Trip').element())
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.count).toBe(1)
      })
      currentBlockSelection()?.commands.makePage()
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(onChange).not.toHaveBeenCalled()
      currentBlockSelection()?.commands.clear()
    })

    it('dates a line before its hidden id, which stays last', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      const { view, editable } = await renderList(onChange, '- call ^a1b2\n')
      swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('call').element())
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.count).toBe(1)
      })
      currentBlockSelection()?.commands.remind(new Date(2026, 10, 20))
      await vi.waitFor(() => {
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- [ ] call [[2026-11-20]] ^a1b2\n')
      })
      currentBlockSelection()?.commands.clear()
    })

    it('selects a page as a block on Backspace after it, without native handles', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      const { view } = await renderList(onChange, PAGE)
      await userEvent.click(view.getByText('after'))
      await userEvent.keyboard('{Home}')
      await new Promise((resolve) => setTimeout(resolve, 50))
      onChange.mockClear()
      await userEvent.keyboard('{Backspace}')
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.isPage).toBe(true)
      })
      expect(onChange).not.toHaveBeenCalled()
      currentBlockSelection()?.commands.clear()
    })

    it('turns a page back into a plain bullet', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      await selectPage(onChange)
      expect(currentBlockSelection()?.state.hasPage).toBe(true)
      currentBlockSelection()?.commands.setKind('bullet')
      await vi.waitFor(() => {
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- Trip\n  - flight\n- after\n')
      })
      currentBlockSelection()?.commands.clear()
    })

    /** Open the page through its card, as a tap does, and wait for the zoom. */
    async function openPage(onChange: (markdown: string) => void, content: string) {
      const rendered = await renderList(onChange, content, true)
      const card = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>('.kore-page-card')
        expect(found).not.toBeNull()
        return found!
      })
      card.click()
      await vi.waitFor(() => {
        expect(document.querySelector('.kore-zoomed .kore-zoom-title')).not.toBeNull()
      })
      return rendered
    }

    // The phone froze here: inside an open page the zoom refuses to unwrap
    // its own item, while the unwrap loop kept being told it could run.
    it('turns an open page into text without freezing, stepping out to show it', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      const { view, editable } = await openPage(onChange, PAGE)
      swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('Trip').element())
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.isPage).toBe(true)
      })
      currentBlockSelection()?.commands.setKind('text')
      await vi.waitFor(() => {
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('Trip\n\n- flight\n- after\n')
      })
      expect(document.querySelector('.kore-zoomed')).toBeNull()
      currentBlockSelection()?.commands.clear()
    })

    it('turns a line inside an open page into text that stays in the page', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      const { view, editable } = await openPage(onChange, PAGE)
      swipe(editable, -(SWIPE_COMMIT_PX + 20), 2, view.getByText('flight').element())
      await vi.waitFor(() => {
        expect(currentBlockSelection()?.state.kind).toBe('bullet')
      })
      currentBlockSelection()?.commands.setKind('text')
      await vi.waitFor(() => {
        expect(onChange.mock.calls.at(-1)?.[0]).toBe('- Trip ^page-a1b2c3\n\n  flight\n\n- after\n')
      })
      expect(document.querySelector('.kore-zoomed .kore-zoom-title')).not.toBeNull()
      currentBlockSelection()?.commands.clear()
    })

    it('duplicates a page under a new id', async () => {
      const onChange = vi.fn<(markdown: string) => void>()
      await selectPage(onChange)
      currentBlockSelection()?.commands.duplicate()
      await vi.waitFor(() => {
        const markdown = onChange.mock.calls.at(-1)?.[0] ?? ''
        const ids = [...markdown.matchAll(/\^(page-[\da-z]{6})/g)].map((match) => match[1])
        expect(ids).toHaveLength(2)
        expect(ids[0]).toBe('page-a1b2c3')
        expect(ids[1]).not.toBe('page-a1b2c3')
      })
      currentBlockSelection()?.commands.clear()
    })
  })
})
