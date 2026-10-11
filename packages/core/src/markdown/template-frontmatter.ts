import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  YAMLMap,
  type Document,
  type Node,
} from 'yaml'
import { frontmatterTagNames } from './extract'
import { parseFrontmatter, splitFrontmatter } from './frontmatter'
import { addNoteTag } from './note-tag'
import { expandTemplatePlaceholders, type TemplatePlaceholderValues } from './template-placeholders'

/**
 * Carry a template's frontmatter into the note it is inserted into, as
 * Obsidian's Templates plugin does: an Obsidian template's properties
 * (`tags: [type/person]`, `up:`, empty `role:` fields to fill) are most of
 * what it is for. Pure; the caller owns the file.
 *
 * - A key the note lacks (or leaves empty) takes the template's value, empty
 *   ones included, written as the template wrote it.
 * - Two lists merge, the note's items first; any other key the note already
 *   fills keeps the note's value.
 * - `tags:` goes through {@link addNoteTag}, so a tag the note already
 *   carries (in either source) is not repeated.
 * - `title:` (a Kore template's own name) and `id:` (note identity) never
 *   travel.
 *
 * Placeholders expand inside string values. Returns `source` unchanged when
 * the template has no frontmatter, or when either side's YAML is malformed
 * (rewriting a block that does not parse would lose bytes).
 */
export function mergeTemplateFrontmatter(
  source: string,
  template: string,
  values: TemplatePlaceholderValues,
): string {
  const templateRaw = splitFrontmatter(template).raw
  if (templateRaw === null || templateRaw.trim() === '') {
    return source
  }
  const templateDoc = parseDocument(templateRaw)
  if (templateDoc.errors.length > 0 || !isMap(templateDoc.contents)) {
    return source
  }
  const { raw, body } = splitFrontmatter(source)
  const noteDoc = parseDocument(raw ?? '')
  if (noteDoc.errors.length > 0 || (noteDoc.contents !== null && !isMap(noteDoc.contents))) {
    return source
  }
  const noteMap: YAMLMap = isMap(noteDoc.contents) ? noteDoc.contents : new YAMLMap()
  noteDoc.contents = noteMap as typeof noteDoc.contents
  let changed = false
  for (const pair of templateDoc.contents.items) {
    const key = isScalar(pair.key) ? pair.key.value : null
    if (typeof key !== 'string' || key === 'title' || key === 'id' || key === 'tags') {
      continue
    }
    const incoming = isNode(pair.value) ? expandNode(pair.value.clone() as Node, values) : null
    const existing = noteMap.get(key, true)
    if (existing === undefined || isEmptyValue(existing)) {
      if (existing === undefined || incoming !== null) {
        noteMap.set(noteDoc.createNode(key), incoming)
        changed = true
      }
      continue
    }
    if (isSeq(existing) && isSeq(incoming)) {
      const seen = new Set(existing.items.map(itemKey))
      for (const item of incoming.items) {
        if (!seen.has(itemKey(item))) {
          existing.items.push(item)
          seen.add(itemKey(item))
          changed = true
        }
      }
    }
  }
  let merged = changed ? withFrontmatter(noteDoc, body) : source
  const templateTags = frontmatterTagNames(parseFrontmatter(templateRaw).data)
  for (const tag of templateTags) {
    merged = addNoteTag(merged, expandTemplatePlaceholders(tag, values)) ?? merged
  }
  return merged
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'clone' in value
}

function isEmptyValue(node: unknown): boolean {
  return isScalar(node) && (node.value === null || node.value === '')
}

function itemKey(item: unknown): string {
  return JSON.stringify(isScalar(item) ? item.value : (item as Node | null)?.toJSON?.())
}

function expandNode(node: Node, values: TemplatePlaceholderValues): Node {
  visit(node, {
    Scalar(_, scalar) {
      if (typeof scalar.value === 'string') {
        scalar.value = expandTemplatePlaceholders(scalar.value, values)
      }
    },
  })
  return node
}

function withFrontmatter(doc: Document, body: string): string {
  const yaml = String(doc)
  return `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n${body}`
}
