import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml'
import { appendBodyTag, bodyHasTag, removeBodyTag } from './body-tag'
import { frontmatterTagNames } from './extract'
import { parseFrontmatter, splitFrontmatter, upsertFrontmatter } from './frontmatter'
import { foldTag } from './keys'

/**
 * A note's tag membership as a whole: the union of body `#hashtags` and the
 * frontmatter `tags:` key, the same two sources `parseNote` indexes. These are
 * the writes behind the Type field and `set_note_type` — the gestures that say
 * "this note is a #book" — so they keep the note's text out of it: a tag is
 * added to `tags:`, and removing one clears it from wherever it is.
 *
 * Same null-or-write contract as `body-tag.ts`: `null` means the note is
 * already where the caller wants it. Pure; the caller owns the file.
 */

/** Whether the note carries `tag` in its body or in frontmatter `tags:`. */
export function noteHasTag(source: string, tag: string): boolean {
  const { raw, body } = splitFrontmatter(source)
  return frontmatterHasTag(raw, tag) || bodyHasTag(body, tag)
}

function frontmatterHasTag(raw: string | null, tag: string): boolean {
  const wanted = foldTag(tag)
  return frontmatterTagNames(parseFrontmatter(raw).data).some((name) => foldTag(name) === wanted)
}

/**
 * `source` with `tag` added to frontmatter `tags:`, or `null` when the note
 * already carries it from either source. An existing list grows in place, so
 * its style and comments survive; a `tags:` string becomes a list. When the
 * frontmatter cannot take the tag — malformed YAML, or a `tags:` value that is
 * neither a list nor a string — the tag goes to the body instead, because
 * overwriting what is there would lose bytes the user wrote.
 */
export function addNoteTag(source: string, tag: string): string | null {
  if (noteHasTag(source, tag)) {
    return null
  }
  const { raw, body } = splitFrontmatter(source)
  if (raw === null) {
    return upsertFrontmatter(source, { tags: [tag] })
  }
  const doc = parseDocument(raw)
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return appendBodyTag(source, tag)
  }
  const node = doc.get('tags', true)
  if (node === undefined || (isScalar(node) && (node.value === null || node.value === ''))) {
    doc.set('tags', [tag])
  } else if (isSeq(node)) {
    node.add(doc.createNode(tag))
  } else if (isScalar(node) && typeof node.value === 'string') {
    doc.set('tags', [...frontmatterTagNames({ tags: node.value }), tag])
  } else {
    return appendBodyTag(source, tag)
  }
  return withFrontmatter(doc, body)
}

/**
 * `source` with `tag` cleared from both sources, or `null` when the note
 * carries it in neither. A `tags:` list left empty is deleted rather than
 * kept as `tags: []`, and a frontmatter block left empty goes with it.
 */
export function removeNoteTag(source: string, tag: string): string | null {
  const fromFrontmatter = removeFrontmatterTag(source, tag)
  const afterFrontmatter = fromFrontmatter ?? source
  const fromBody = removeBodyTag(afterFrontmatter, tag)
  if (fromFrontmatter === null && fromBody === null) {
    return null
  }
  return fromBody ?? afterFrontmatter
}

function removeFrontmatterTag(source: string, tag: string): string | null {
  const { raw, body } = splitFrontmatter(source)
  if (!frontmatterHasTag(raw, tag)) {
    return null
  }
  // `frontmatterHasTag` saw the tag, so the YAML parsed and `tags:` is a list
  // or a string; only those two shapes are rewritten.
  const doc = parseDocument(raw ?? '')
  if (doc.errors.length > 0) {
    return null
  }
  const wanted = foldTag(tag)
  const isWanted = (value: unknown): boolean =>
    frontmatterTagNames({ tags: [value] }).some((name) => foldTag(name) === wanted)
  const node = doc.get('tags', true)
  let remaining: number
  if (isSeq(node)) {
    node.items = node.items.filter((item) => !isWanted(isScalar(item) ? item.value : item))
    remaining = node.items.length
  } else if (isScalar(node) && typeof node.value === 'string') {
    const names = frontmatterTagNames({ tags: node.value }).filter((name) => !isWanted(name))
    doc.set('tags', names)
    remaining = names.length
  } else {
    return null
  }
  if (remaining === 0) {
    doc.delete('tags')
  }
  return withFrontmatter(doc, body)
}

/** Re-attach a patched frontmatter document, dropping the block once it is empty. */
function withFrontmatter(doc: Document, body: string): string {
  const yaml = String(doc)
  if (
    isMap(doc.contents) &&
    doc.contents.items.length === 0 &&
    doc.commentBefore == null &&
    doc.comment == null
  ) {
    return body
  }
  return `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n${body}`
}
