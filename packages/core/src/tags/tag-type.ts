import { z } from 'zod'
import { TAGS_DIR } from '../graph/paths'
import { foldTag, isTagName, type Frontmatter } from '../markdown'

/**
 * Tag types (TDR 0005): a tag becomes a *type* when the graph carries a
 * definition note at `tags/<name>.md` whose frontmatter is marked
 * `lore: tag`. The definition's `properties` list is the schema a Collection
 * view renders as columns and a note's properties panel renders as fields.
 *
 * Both conditions are required on purpose: the path alone must not claim
 * pre-existing user notes under `tags/`, and the marker alone must not turn
 * an arbitrarily-placed note into a definition the path can't address.
 */

/** The `lore:` frontmatter value that marks a note as a tag definition. */
export const TAG_TYPE_MARKER = 'tag'

/** Property value kinds a tag schema can declare (V1 set). */
export const tagPropertyTypeSchema = z.enum([
  'text',
  'number',
  'checkbox',
  'date',
  'select',
  'multiselect',
  'url',
])
export type TagPropertyType = z.infer<typeof tagPropertyTypeSchema>

/**
 * One property of a tag type. `key` is the flat frontmatter key the value
 * lives under in each note — shared across tags Obsidian-style, so two types
 * declaring `author` read and write the same value.
 */
export const tagPropertySchema = z.object({
  /** Display label ("Read on"). */
  name: z.string().min(1),
  /** Frontmatter key ("read-on") — validated by {@link isPropertyKey}. */
  key: z.string().min(1),
  type: tagPropertyTypeSchema,
  /** Choices for `select` / `multiselect`; ignored for other types. */
  options: z.array(z.string()).optional(),
})
export type TagProperty = z.infer<typeof tagPropertySchema>

/** A tag's schema: the ordered property list a Collection renders as columns. */
export interface TagType {
  properties: TagProperty[]
}

/**
 * Frontmatter keys a tag schema may never claim: the app's own metadata plus
 * the definition-note keys themselves. Kept here (not in `properties.ts`)
 * because both the schema validator and the indexer share the one set.
 */
export const RESERVED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'aliases',
  'private',
  'pinned',
  'gist',
  'ignoredContacts',
  'lore',
  'properties',
])

/** Property keys are plain YAML-safe identifiers, never reserved. */
const PROPERTY_KEY_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u

/** Is `key` usable as a tag-property frontmatter key? */
export function isPropertyKey(key: string): boolean {
  return PROPERTY_KEY_RE.test(key) && !RESERVED_FRONTMATTER_KEYS.has(key)
}

/** Derive a frontmatter key from a display name ("Read on" → "read-on"). */
export function propertyKeyForName(name: string): string {
  const slug = name
    .normalize('NFC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
  return isPropertyKey(slug) ? slug : ''
}

/**
 * Read a tag type out of a definition note's frontmatter, or `null` when the
 * marker is absent. Tolerant like every frontmatter read: a malformed entry
 * in `properties` is dropped (never fails the note), duplicate or reserved
 * keys keep only the first well-formed occurrence.
 */
export function parseTagTypeFrontmatter(frontmatter: Frontmatter): TagType | null {
  if (frontmatter['lore'] !== TAG_TYPE_MARKER) {
    return null
  }
  const raw = frontmatter['properties']
  const entries = Array.isArray(raw) ? raw : []
  const properties: TagProperty[] = []
  const claimed = new Set<string>()
  for (const entry of entries) {
    const parsed = tagPropertySchema.safeParse(entry)
    if (!parsed.success) {
      continue
    }
    const property = parsed.data
    if (!isPropertyKey(property.key) || claimed.has(property.key)) {
      continue
    }
    claimed.add(property.key)
    properties.push(property)
  }
  return { properties }
}

/**
 * The `tag_types.schema_json` column's format: the validated property list as
 * one JSON string (the `encodeTaskBreadcrumbs` pattern — every writer and
 * reader of the column goes through this pair).
 */
export function encodeTagTypeJson(type: TagType): string {
  return JSON.stringify(type.properties)
}

export function decodeTagTypeJson(column: string): TagType {
  const properties = z.array(tagPropertySchema).parse(JSON.parse(column))
  return { properties }
}

/**
 * The tag name a definition path addresses (`tags/project/atlas.md` →
 * `project/atlas`), or `null` when the path is not under `tags/` or the stem
 * is not a valid tag name. Purely lexical — the marker check is separate.
 */
export function tagNameForDefinitionPath(path: string): string | null {
  const stem = path.startsWith(`${TAGS_DIR}/`)
    ? path.slice(TAGS_DIR.length + 1).replace(/\.md$/, '')
    : null
  if (stem === null || stem === '' || `${TAGS_DIR}/${stem}.md` !== path) {
    return null
  }
  return isTagName(stem) ? stem : null
}

/** Graph-relative definition path for a tag (callers pass the display name). */
export function tagDefinitionPath(tag: string): string {
  return `${TAGS_DIR}/${foldTag(tag)}.md`
}

/**
 * Is this note a tag definition? Requires both the `tags/<name>.md` path and
 * the `lore: tag` marker, so pre-existing user notes under `tags/` keep their
 * ordinary kind until explicitly converted.
 */
export function isTagDefinitionNote(path: string, frontmatter: Frontmatter): boolean {
  return tagNameForDefinitionPath(path) !== null && frontmatter['lore'] === TAG_TYPE_MARKER
}
