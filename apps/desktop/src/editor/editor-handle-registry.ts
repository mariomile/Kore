import type { NoteEditorHandle } from '@/editor/note-editor'

/**
 * The mounted note editors, keyed by graph-relative note path. Commands that
 * act on "the current note's editor" (Attach file…) resolve the handle for
 * `CommandContext.notePath()` here — the same path the context sidebar and
 * note-scoped commands target, so an insertion can never land in a different
 * note than the one those commands describe.
 *
 * Module-level rather than a provider: registrations come from render-phase
 * ref callbacks and reads from command dispatch, neither of which needs
 * React state or re-renders (the same shape as `operations.ts`).
 */
const handles = new Map<string, NoteEditorHandle>()

/**
 * Headings a followed link (`[[Plan#Next steps]]`) asked for in a note whose
 * editor is not mounted yet. The pane registers its handle once the note has
 * loaded, and that registration reveals the heading. An entry nobody claims
 * (the navigation failed or went elsewhere) expires, so opening the note
 * later from the sidebar never jumps to a stale heading.
 */
const pendingReveals = new Map<string, { heading: string; at: number }>()
const PENDING_REVEAL_TTL_MS = 5000

/**
 * Reveal on the frame after next: the arrival's own autofocus (which puts the
 * caret at the note start) and the pane's layout both settle first, so the
 * scroll lands on the heading instead of being undone.
 */
function scheduleReveal(path: string, heading: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      handles.get(path)?.revealHeading?.(heading)
    })
  })
}

/**
 * Scroll `path`'s editor to `heading` as soon as it is on screen: now when the
 * note is already open (a same-note `[[#Heading]]`, or a pane that already
 * holds it), otherwise when its editor mounts.
 */
export function revealNoteHeading(path: string, heading: string): void {
  if (handles.has(path)) {
    pendingReveals.delete(path)
    scheduleReveal(path, heading)
    return
  }
  pendingReveals.set(path, { heading, at: Date.now() })
}

/** Make `handle` the editor for `path` (the pane's ref callback, on mount). */
export function registerNoteEditorHandle(path: string, handle: NoteEditorHandle): void {
  handles.set(path, handle)
  const pending = pendingReveals.get(path)
  if (pending !== undefined) {
    pendingReveals.delete(path)
    if (Date.now() - pending.at <= PENDING_REVEAL_TTL_MS) {
      scheduleReveal(path, pending.heading)
    }
  }
}

/**
 * Remove `handle`'s registration (the pane's ref callback, on unmount). A
 * no-op when another editor has since registered the same path, so an
 * unmount racing a remount never drops the live handle.
 */
export function unregisterNoteEditorHandle(path: string, handle: NoteEditorHandle): void {
  if (handles.get(path) === handle) {
    handles.delete(path)
  }
}

/** The mounted editor for a note path, or null when none is on screen. */
export function noteEditorHandleFor(path: string): NoteEditorHandle | null {
  return handles.get(path) ?? null
}
