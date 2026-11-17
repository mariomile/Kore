import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteEditorHandle } from './note-editor'
import {
  registerNoteEditorHandle,
  revealNoteHeadingOnNoteScreen,
  unregisterNoteEditorHandle,
} from './editor-handle-registry'

function fakeHandle(): NoteEditorHandle & { revealHeading: ReturnType<typeof vi.fn> } {
  return { revealHeading: vi.fn(() => true) } as unknown as NoteEditorHandle & {
    revealHeading: ReturnType<typeof vi.fn>
  }
}

const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('revealNoteHeadingOnNoteScreen', () => {
  const registered: [string, NoteEditorHandle][] = []
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (step: () => void) => setTimeout(step, 0))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [path, handle] of registered.splice(0)) unregisterNoteEditorHandle(path, handle)
  })

  it("leaves the page to the note's own screen, not the day already showing it", async () => {
    const day = fakeHandle()
    registerNoteEditorHandle('daily/2026-11-17.md', day, false)
    registered.push(['daily/2026-11-17.md', day])
    revealNoteHeadingOnNoteScreen('daily/2026-11-17.md', '^page-a1b2c3')
    // The day re-registers on a re-render: it does not claim the reveal.
    registerNoteEditorHandle('daily/2026-11-17.md', day, false)
    const screen = fakeHandle()
    registerNoteEditorHandle('daily/2026-11-17.md', screen)
    registered.push(['daily/2026-11-17.md', screen])
    // ...nor when it registers again after the screen did.
    registerNoteEditorHandle('daily/2026-11-17.md', day, false)
    await flushFrames()
    expect(day.revealHeading).not.toHaveBeenCalled()
    expect(screen.revealHeading).toHaveBeenCalledWith('^page-a1b2c3', { asScreen: true })
  })
})
