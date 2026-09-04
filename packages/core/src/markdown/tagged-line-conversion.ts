import { foldTag } from './keys'
import { wikiLinkTargetForTitle } from './note-title'

/** The same tag grammar `body-tag.ts` scans for, anchored to one candidate. */
const TAG_TOKEN = /(?:^|\s)#(\p{L}[\p{L}\p{N}/_-]*)/gu

/** A leading list marker (bullet, ordered, or task checkbox) to preserve. */
const LEADING_MARKER = /^(?:\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s+)?)?/i

export interface TaggedLineConversion {
  /** The line's text minus every `#tag` occurrence, or "Untitled" when bare. */
  readonly title: string
  /** The line that replaces it: the marker, a wiki link to the title, and the tag. */
  readonly replacementLine: string
}

/**
 * The Tana gesture: turn one daily-note line carrying `#tag` into a new
 * note's title and the line that replaces it in the daily.
 *
 * The title is the line's text with every occurrence of `#tag` (fold-matched,
 * so `#Meeting` and `#meeting` both count) removed and whitespace collapsed —
 * "Untitled" when nothing is left, matching the app's normal untitled-note
 * seed. Wiki links inside the line flatten to their text, so the title can
 * itself be a wiki link target (`[[Lunch with [[Sam]]]]` is no link). The
 * replacement keeps the line's leading list marker (if any) and the tag
 * itself, so the daily stays a member of the collection through a wiki link
 * instead of losing the row.
 *
 * Pure and unit-tested; the caller owns locating the line and writing it back.
 */
export function convertTaggedLineToNote(line: string, tag: string): TaggedLineConversion {
  const wanted = foldTag(tag)
  const markerMatch = line.match(LEADING_MARKER)
  const marker = markerMatch?.[0] ?? ''
  const rest = line.slice(marker.length)
  const withoutTag = rest
    .replaceAll(TAG_TOKEN, (full, tagName: string) => (foldTag(tagName) === wanted ? '' : full))
    .replaceAll(/\s+/g, ' ')
    .trim()
  const title = withoutTag === '' ? 'Untitled' : wikiLinkTargetForTitle(withoutTag)
  return {
    title,
    replacementLine: `${marker}[[${title}]] #${tag}`,
  }
}
