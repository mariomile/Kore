import { tagExcludedRanges } from './extract'
import { splitFrontmatter } from './frontmatter'
import { foldTag } from './keys'
import type { Span } from './model'

/**
 * Adding a tag to a note's text, for the bulk-tag action.
 *
 * Tags in this app are inline `#hashtags` scanned from the body — frontmatter
 * has no `tags:` key the indexer reads (see `collectTags` in `extract.ts`), so
 * tagging means editing prose, not metadata. That makes idempotence the whole
 * job: bulk-tagging the same selection twice must not append the tag twice,
 * and a note that already carries an indexed `#tag` must be left
 * byte-identical so it never shows up as changed.
 *
 * Pure and unit-tested; the caller owns reading and writing the file.
 */

/** The same tag grammar `extract.ts` scans for, anchored to one candidate. */
const TAG_ANYWHERE = /(?:^|\s)#(\p{L}[\p{L}\p{N}/_-]*)/gu

function inAnyRange(index: number, ranges: readonly Span[]): boolean {
  return ranges.some((range) => index >= range.from && index < range.to)
}

/** Body offset of the `#` in a {@link TAG_ANYWHERE} match. */
function tagHashIndex(match: RegExpMatchArray): number {
  const index = match.index ?? 0
  return match[0].startsWith('#') ? index : index + 1
}

/**
 * The `#tag` token plus one adjacent same-line space, never a newline.
 * Leading `\s` in {@link TAG_ANYWHERE} also matches `\n`, and swallowing that
 * glues the next paragraph onto the previous one.
 */
function tagTokenRange(body: string, match: RegExpMatchArray): { start: number; end: number } {
  const hashIndex = tagHashIndex(match)
  const endOfName = (match.index ?? 0) + match[0].length
  const before = hashIndex > 0 ? body[hashIndex - 1] : ''
  if (before === ' ' || before === '\t') {
    return { start: hashIndex - 1, end: endOfName }
  }
  if (body[endOfName] === ' ' || body[endOfName] === '\t') {
    return { start: hashIndex, end: endOfName + 1 }
  }
  return { start: hashIndex, end: endOfName }
}

/** Whether `body` already carries `tag`, folded the way the index folds it. */
export function bodyHasTag(body: string, tag: string): boolean {
  const wanted = foldTag(tag)
  const excluded = tagExcludedRanges(body)
  for (const match of body.matchAll(TAG_ANYWHERE)) {
    if (inAnyRange(tagHashIndex(match), excluded)) {
      continue
    }
    if (foldTag(match[1]!) === wanted) {
      return true
    }
  }
  return false
}

/**
 * `source` with `#tag` appended on its own trailing line, or `null` when the
 * note already carries the tag — null, not the unchanged string, so a caller
 * can tell "nothing to do" from "here is a write" without comparing.
 *
 * The tag lands at the end of the body rather than inside it: anywhere else
 * would mean guessing at the note's structure, and a trailing line is the one
 * position that reads the same in every note. Frontmatter is preserved
 * untouched, and a note whose body is only whitespace gets the tag without a
 * leading blank run.
 */
export function appendBodyTag(source: string, tag: string): string | null {
  const { raw, body } = splitFrontmatter(source)
  if (bodyHasTag(body, tag)) {
    return null
  }
  const trimmed = body.replace(/\s+$/, '')
  // One blank line before the tag when there is prose above it; none when the
  // body is empty, so a fresh note doesn't open with a gap.
  const nextBody = trimmed === '' ? `#${tag}\n` : `${trimmed}\n\n#${tag}\n`
  return raw === null ? nextBody : `---\n${raw}\n---\n${nextBody}`
}

/**
 * `source` with every `#tag` token the indexer would extract removed, or
 * `null` when the note does not carry the tag — same null-vs-write contract
 * as {@link appendBodyTag}. Inline mentions and trailing membership lines
 * are the same fact (the hashtag is the supertag), so unsetting Type has
 * to clear every occurrence or the note would stay in the collection.
 *
 * Surrounding same-line space of each token is consumed with it so
 * "Reading #book tonight" becomes "Reading tonight", not a doubled space;
 * a `#tag` that opens a later line keeps its newline so paragraphs stay
 * apart. Leftover blank runs at the start, end, or between paragraphs
 * collapse. Hits inside code or wiki targets are left alone — they are
 * not the indexed membership {@link bodyHasTag} reports.
 */
export function removeBodyTag(source: string, tag: string): string | null {
  const { raw, body } = splitFrontmatter(source)
  const wanted = foldTag(tag)
  if (!bodyHasTag(body, wanted)) {
    return null
  }
  const excluded = tagExcludedRanges(body)
  let nextBody = ''
  let cursor = 0
  for (const match of body.matchAll(TAG_ANYWHERE)) {
    const name = match[1]!
    if (foldTag(name) !== wanted) {
      continue
    }
    const hashIndex = tagHashIndex(match)
    if (inAnyRange(hashIndex, excluded)) {
      continue
    }
    const range = tagTokenRange(body, match)
    nextBody += body.slice(cursor, range.start)
    cursor = range.end
  }
  nextBody += body.slice(cursor)
  nextBody = nextBody
    .replaceAll(/[ \t]+\n/g, '\n')
    .replace(/^\n+/, '')
    .replaceAll(/\n{3,}/g, '\n\n')
  if (nextBody.trim() === '') {
    nextBody = ''
  } else {
    nextBody = nextBody.replace(/\n+$/, '\n')
    if (!nextBody.endsWith('\n')) {
      nextBody += '\n'
    }
  }
  return raw === null ? nextBody : `---\n${raw}\n---\n${nextBody}`
}
