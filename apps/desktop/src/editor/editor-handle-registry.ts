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
const pendingReveals = new Map<string, { heading: string; at: number; noteScreen?: boolean }>()
const PENDING_REVEAL_TTL_MS = 5000

/**
 * Reveal on the frame after next: the arrival's own autofocus (which puts the
 * caret at the note start) and the pane's layout both settle first, so the
 * scroll lands on the heading instead of being undone.
 */
function scheduleReveal(path: string, heading: string, target?: NoteEditorHandle): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ;(target ?? handles.get(path))?.revealHeading?.(heading)
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

/**
 * Reveal `heading` once the note's own screen mounts an editor for `path`,
 * even while another editor already shows the note: the phone's daily
 * carousel opens a sub page on the note's screen, over the day that holds it.
 */
export function revealNoteHeadingOnNoteScreen(path: string, heading: string): void {
  pendingReveals.set(path, { heading, at: Date.now(), noteScreen: true })
}

/**
 * Make `handle` the editor for `path` (the pane's ref callback, on mount).
 * `onNoteScreen` is false for an editor that is not the note's own screen
 * (a day of the phone's carousel), which leaves a reveal meant for that
 * screen to it.
 */
export function registerNoteEditorHandle(
  path: string,
  handle: NoteEditorHandle,
  onNoteScreen = true,
): void {
  handles.set(path, handle)
  const pending = pendingReveals.get(path)
  if (pending !== undefined && (onNoteScreen || pending.noteScreen !== true)) {
    pendingReveals.delete(path)
    if (Date.now() - pending.at <= PENDING_REVEAL_TTL_MS) {
      // A reveal meant for the note's screen goes to that screen's editor
      // even if the day showing the note registers again meanwhile.
      scheduleReveal(path, pending.heading, pending.noteScreen === true ? handle : undefined)
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
