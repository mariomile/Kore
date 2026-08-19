import { readNote, writeNote } from '../graph/commands'
import { findUnlinkedOccurrence } from '../indexing/unlinked-mentions'

/**
 * How a {@link linkUnlinkedMention} request ended: `linked` rewrote the
 * source note; `gone` means no unlinked occurrence survived to the write —
 * the note changed since the panel rendered (or someone linked it first),
 * and there is nothing left to convert.
 */
export type LinkMentionOutcome = 'linked' | 'gone'

/** Characters that would break the `[[target|alias]]` syntax if embedded raw. */
const UNSAFE_TITLE_RE = /[[\]|]/

/**
 * Convert the first unlinked mention of `targetTitle` inside `sourcePath`
 * into a wiki link. The occurrence is re-found on a fresh read rather than
 * trusted from the panel's offset — the note may have changed since the
 * panel queried — so the edit always lands on live text or not at all.
 * A match that differs from the title only by case keeps its own spelling
 * as the alias (`[[Title|title]]`), leaving the prose exactly as written.
 * Titles carrying wiki-link syntax characters report `gone` rather than
 * writing a link that would not parse back.
 */
export async function linkUnlinkedMention(input: {
  sourcePath: string
  targetTitle: string
  generation: number
}): Promise<LinkMentionOutcome> {
  const title = input.targetTitle.trim()
  if (title.length === 0 || UNSAFE_TITLE_RE.test(title)) {
    return 'gone'
  }
  const content = await readNote(input.sourcePath)
  const occurrence = findUnlinkedOccurrence(content, title)
  if (occurrence === null) {
    return 'gone'
  }
  const matched = content.slice(occurrence.from, occurrence.to)
  const link = matched === title ? `[[${title}]]` : `[[${title}|${matched}]]`
  const updated = content.slice(0, occurrence.from) + link + content.slice(occurrence.to)
  await writeNote(input.sourcePath, updated, input.generation)
  return 'linked'
}
