import { splitFrontmatter } from './frontmatter'
import { foldTag } from './keys'

/**
 * Adding a tag to a note's text, for the bulk-tag action.
 *
 * Tags in this app are inline `#hashtags` scanned from the body — frontmatter
 * has no `tags:` key the indexer reads (see `collectTags` in `extract.ts`), so
 * tagging means editing prose, not metadata. That makes idempotence the whole
 * job: bulk-tagging the same selection twice must not append the tag twice,
 * and a note that already carries the tag anywhere in its body must be left
 * byte-identical so it never shows up as changed.
 *
 * Pure and unit-tested; the caller owns reading and writing the file.
 */

/** The same tag grammar `extract.ts` scans for, anchored to one candidate. */
const TAG_ANYWHERE = /(?:^|\s)#(\p{L}[\p{L}\p{N}/_-]*)/gu

/** Whether `body` already carries `tag`, folded the way the index folds it. */
export function bodyHasTag(body: string, tag: string): boolean {
  const wanted = foldTag(tag)
  for (const match of body.matchAll(TAG_ANYWHERE)) {
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
