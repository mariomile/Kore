import { appendBodyTag } from '@kore/core/markdown/body-tag'
import { splitFrontmatter, upsertFrontmatter } from '@kore/core/markdown/frontmatter'

/**
 * The structural edits an agent may make, as pure source → source functions
 * mirroring the `kore` CLI's (`append`, `edit`, `new`, `set`), so a note
 * written through Kore Cloud reads exactly as one written on the Mac.
 */

function lineEnding(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

/** `source` with `block` after one blank line (none when empty), in the note's line ending. */
export function appendBlock(source: string, block: string): string {
  const ending = lineEnding(source)
  const normalized = block
    .replaceAll('\r\n', '\n')
    .replaceAll(/^[\r\n]+|[\r\n]+$/g, '')
    .replaceAll('\n', ending)
  const body = source.replace(/[\r\n]+$/, '')
  return body === '' ? `${normalized}${ending}` : `${body}${ending}${ending}${normalized}${ending}`
}

/** Why an exact-passage edit could not apply. */
export type EditRefusal = 'missing' | 'ambiguous'

/**
 * Replace the one occurrence of `oldText` in the body (frontmatter is out of
 * reach), or append `newText` when `oldText` is empty. A passage that is
 * missing or repeated refuses, so the edit never lands on text the agent did
 * not read.
 */
export function replacePassage(
  source: string,
  oldText: string,
  newText: string,
): { source: string } | { refused: EditRefusal } {
  if (oldText === '') {
    return { source: appendBlock(source, newText) }
  }
  const { bodyOffset } = splitFrontmatter(source)
  const body = source.slice(bodyOffset)
  const first = body.indexOf(oldText)
  if (first === -1) {
    return { refused: 'missing' }
  }
  if (body.includes(oldText, first + 1)) {
    return { refused: 'ambiguous' }
  }
  const next = body.slice(0, first) + newText + body.slice(first + oldText.length)
  return { source: source.slice(0, bodyOffset) + next }
}

/** A new note's source: H1 title, optional body, trailing tag line, frontmatter properties. */
export function newNoteSource(
  title: string,
  body: string,
  tags: readonly string[],
  properties: Record<string, unknown>,
): string {
  const trimmed = body.replace(/^[\r\n]+/, '')
  let source =
    trimmed === ''
      ? `# ${title}\n`
      : trimmed.startsWith('# ')
        ? trimmed
        : `# ${title}\n\n${trimmed}`
  if (!source.endsWith('\n')) {
    source += '\n'
  }
  for (const tag of tags) {
    source = appendBodyTag(source, tag) ?? source
  }
  return upsertFrontmatter(source, properties)
}

/** Set (`set`) and remove (`unset`) frontmatter keys, keeping everything else byte for byte. */
export function patchProperties(
  source: string,
  set: Record<string, unknown>,
  unset: readonly string[],
): string {
  const patch: Record<string, unknown> = { ...set }
  for (const key of unset) {
    patch[key] = undefined
  }
  return upsertFrontmatter(source, patch)
}

/** A tag name as the CLI accepts it: a letter, then letters, digits, `/`, `_` or `-`. */
export function isTagName(tag: string): boolean {
  return /^\p{L}[\p{L}\p{N}/_-]*$/u.test(tag)
}
