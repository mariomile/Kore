import { splitFrontmatter } from '../../markdown/frontmatter'

/**
 * The one edit shape the chat's `edit_note` tool proposes and the user
 * reviews: replace one exact passage of a note's body with another, or
 * append when there is nothing to replace. Shared by the tool (which
 * validates the proposal against the note at proposal time) and the apply
 * path (which re-validates against the note as it is when the user accepts),
 * so a note that moved on in between refuses instead of landing a stale
 * patch somewhere else. Frontmatter is never in reach: the model reads the
 * body alone, so the body alone is what it can change.
 */
export interface NoteEdit {
  /** The exact current body text to replace; empty means append to the end. */
  oldText: string
  /** The replacement (or, for an append, the text to add). */
  newText: string
}

export type NoteEditResult = { ok: true; after: string } | { ok: false; error: string }

/** Refusals, read verbatim by the model and shown in the review card. */
export const EDIT_TEXT_NOT_FOUND_ERROR =
  'The text to replace was not found in the note. Re-read the note and pass its exact current text.'
export const EDIT_TEXT_AMBIGUOUS_ERROR =
  'The text to replace appears more than once in the note — include more surrounding lines so it matches exactly once.'
export const EDIT_NO_CHANGE_ERROR = 'The edit changes nothing.'

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) {
      return count
    }
    count += 1
    from = index + needle.length
  }
}

/**
 * Apply `edit` to the note `source`, returning the whole note (frontmatter
 * untouched) or a refusal. The replaced passage must occur exactly once in
 * the body; an append lands after the body's last line.
 */
export function applyNoteEdit(source: string, edit: NoteEdit): NoteEditResult {
  const { body, bodyOffset } = splitFrontmatter(source)
  const header = source.slice(0, bodyOffset)
  let nextBody: string
  if (edit.oldText === '') {
    nextBody = body === '' || body.endsWith('\n') ? body + edit.newText : `${body}\n${edit.newText}`
  } else {
    const occurrences = countOccurrences(body, edit.oldText)
    if (occurrences === 0) {
      return { ok: false, error: EDIT_TEXT_NOT_FOUND_ERROR }
    }
    if (occurrences > 1) {
      return { ok: false, error: EDIT_TEXT_AMBIGUOUS_ERROR }
    }
    nextBody = body.replace(edit.oldText, () => edit.newText)
  }
  if (nextBody === body) {
    return { ok: false, error: EDIT_NO_CHANGE_ERROR }
  }
  return { ok: true, after: header + nextBody }
}
