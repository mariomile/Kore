import { renderHook } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getKeyboardHeight,
  publishKeyboardHeight,
  refreshFieldCaret,
  useKeyboardFieldReveal,
  useKeyboardHeightVar,
  useKeyboardVisible,
} from './use-keyboard'
import { act } from '@/test-utils/act'

/**
 * The keyboard-height store behind `--keyboard-height`: imperative consumers
 * (the day carousel's drag guard fires at drag start, outside React) read the
 * last published overlap through {@link getKeyboardHeight}; reactive ones
 * (the shell hiding the tab bar) subscribe through {@link useKeyboardVisible}.
 */
describe('keyboard height store', () => {
  afterEach(() => {
    publishKeyboardHeight(0)
  })

  it('starts closed and reflects the last published height', async () => {
    expect(getKeyboardHeight()).toBe(0)
    publishKeyboardHeight(316)
    expect(getKeyboardHeight()).toBe(316)
    publishKeyboardHeight(0)
    expect(getKeyboardHeight()).toBe(0)
  })

  it('exposes visibility as reactive state', async () => {
    const view = await renderHook(() => useKeyboardVisible())
    expect(view.result.current).toBe(false)

    await act(() => publishKeyboardHeight(316))
    expect(view.result.current).toBe(true)

    await act(() => publishKeyboardHeight(0))
    expect(view.result.current).toBe(false)
    await view.unmount()
  })

  it('keeps notifying after an unrelated subscriber unmounts', async () => {
    const first = await renderHook(() => useKeyboardVisible())
    const second = await renderHook(() => useKeyboardVisible())
    await first.unmount()
    await act(() => publishKeyboardHeight(280))
    expect(second.result.current).toBe(true)
    await second.unmount()
  })
})

/**
 * The visual-viewport half of the store: with the webview pinned by
 * `KeyboardPlugin.swift`, `window.innerHeight - visualViewport.height` is the
 * keyboard overlap. A fake viewport stands in for the real one, which never
 * shrinks inside the test browser.
 */
describe('useKeyboardHeightVar', () => {
  class FakeVisualViewport extends EventTarget {
    height = 800
    offsetTop = 0
    scale = 1
  }

  function installViewport(): FakeVisualViewport {
    const viewport = new FakeVisualViewport()
    Object.defineProperties(window, {
      visualViewport: { value: viewport, configurable: true },
      innerHeight: { value: 800, configurable: true },
    })
    return viewport
  }

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'visualViewport')
    Reflect.deleteProperty(window, 'innerHeight')
    publishKeyboardHeight(0)
  })

  it('mirrors the viewport shortfall into the store and the CSS variable', async () => {
    const viewport = installViewport()
    const view = await renderHook(() => useKeyboardHeightVar())

    viewport.height = 464
    await act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(getKeyboardHeight()).toBe(336)
    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('336px')

    viewport.height = 800
    await act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(getKeyboardHeight()).toBe(0)
    await view.unmount()
  })

  it('ignores a shrink at or under the keyboard threshold', async () => {
    const viewport = installViewport()
    const view = await renderHook(() => useKeyboardHeightVar())

    viewport.height = 745
    await act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(getKeyboardHeight()).toBe(0)
    await view.unmount()
  })

  it('clears a stale overlap once focus has left every editable element', async () => {
    const viewport = installViewport()
    const view = await renderHook(() => useKeyboardHeightVar())

    viewport.height = 464
    await act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(getKeyboardHeight()).toBe(336)

    // iOS 26.0: the keyboard closed, but the viewport still reports 464.
    vi.useFakeTimers()
    await act(() => {
      document.dispatchEvent(new Event('focusout'))
    })
    await act(() => {
      vi.advanceTimersByTime(1750)
    })
    expect(getKeyboardHeight()).toBe(0)
    vi.useRealTimers()
    await view.unmount()
  })
})

/**
 * iOS draws a form field's caret natively and only re-reads its rect on a
 * selection change, so a field that moves by layout (a sheet growing past the
 * keyboard, an open transition ending) needs a real selection change that
 * leaves focus, value and selection exactly as they were.
 */
describe('refreshFieldCaret', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  function mountField(value: string): HTMLTextAreaElement {
    const field = document.createElement('textarea')
    field.value = value
    document.body.append(field)
    field.focus()
    return field
  }

  it('keeps focus and the selection, and reports a selection change', async () => {
    const field = mountField('Idea widget')
    field.setSelectionRange(2, 6, 'backward')
    // Let the selectionchange the setup queued fire before listening.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const changed = vi.fn()
    document.addEventListener('selectionchange', changed)

    refreshFieldCaret(field)
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.removeEventListener('selectionchange', changed)

    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('Idea widget')
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([
      2,
      6,
      'backward',
    ])
    expect(changed).toHaveBeenCalled()
  })

  it('keeps the caret of an empty field at its start', () => {
    const field = mountField('')
    refreshFieldCaret(field)
    expect(document.activeElement).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 0])
  })

  it('leaves an unfocused field alone', () => {
    const field = mountField('abc')
    field.setSelectionRange(1, 1)
    field.blur()
    refreshFieldCaret(field)
    expect(document.activeElement).not.toBe(field)
    expect(field.selectionStart).toBe(1)
  })

  it('re-anchors the focused field when a transform transition around it ends', async () => {
    const view = await renderHook(() => useKeyboardFieldReveal())
    const sheet = document.createElement('div')
    document.body.append(sheet)
    const field = document.createElement('textarea')
    sheet.append(field)
    field.focus()
    const setSelectionRange = vi.spyOn(field, 'setSelectionRange')

    sheet.dispatchEvent(
      new TransitionEvent('transitionend', {
        propertyName: 'opacity',
        bubbles: true,
      }),
    )
    expect(setSelectionRange).not.toHaveBeenCalled()
    sheet.dispatchEvent(
      new TransitionEvent('transitionend', {
        propertyName: 'transform',
        bubbles: true,
      }),
    )
    expect(setSelectionRange).toHaveBeenCalledWith(0, 0, expect.anything())
    await view.unmount()
  })
})
