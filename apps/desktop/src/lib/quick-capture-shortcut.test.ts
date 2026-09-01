import { describe, expect, it } from 'vitest'
import { quickCaptureBindingFromEvent } from './quick-capture-shortcut'

function chord(
  code: string,
  modifiers: Partial<{
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
  }> = {},
) {
  return {
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  }
}

describe('quickCaptureBindingFromEvent', () => {
  it('normalizes platform chords by physical key', () => {
    expect(
      quickCaptureBindingFromEvent(chord('Slash', { metaKey: true, shiftKey: true }), true),
    ).toBe('Mod-Shift-Slash')
    expect(
      quickCaptureBindingFromEvent(chord('KeyK', { ctrlKey: true, altKey: true }), false),
    ).toBe('Mod-Alt-K')
    expect(quickCaptureBindingFromEvent(chord('KeyK', { ctrlKey: true }), true)).toBe('Ctrl-K')
  })

  it('rejects unmodified and unsupported keys', () => {
    expect(quickCaptureBindingFromEvent(chord('KeyK'), true)).toBeNull()
    expect(quickCaptureBindingFromEvent(chord('Escape', { metaKey: true }), true)).toBeNull()
  })
})
