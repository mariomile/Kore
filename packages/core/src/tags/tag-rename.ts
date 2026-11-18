import { isMap, isScalar, isSeq, parseDocument, type Scalar, type YAMLSeq } from 'yaml'
import { renameBodyTags } from '../markdown/body-tag'
import { isTagName } from '../markdown/extract'
import { splitFrontmatter } from '../markdown/frontmatter'
import { foldTag } from '../markdown/keys'
import { tagDefinitionPath } from './tag-type'

/**
 * Renaming a tag across the vault, and merging it into another (Tag Wrangler
 * in Obsidian). A tag has no single home: it is written into every note that
 * carries it, in frontmatter `tags:` and as body `#hashtags`, and a type's
 * definition (`tags/<name>.md`) plus other definitions' `extends:` and
 * relation `target:` refer to it by name. A rename therefore rewrites text in
 * many notes; this module computes those rewrites and nothing else. Reading,
 * the dirty-buffer gate, writing and undo belong to the caller.
 *
 * Text surgery, not re-serialization: only the characters of the tag name
 * change. Re-dumping the YAML would re-fold long values and requote strings
 * across thousands of notes, a noisy diff in every file the user never meant
 * to touch, and the vault has to stay byte-friendly for Obsidian and git.
 *
 * Nested tags follow their parent, as in the sidebar's tree: renaming
 * `type/project` to `project` turns `type/project/client` into
 * `project/client`. Renaming onto a tag that already exists is a merge: the
 * two become one, and a note that ends up listing it twice keeps one.
 */

/** A rename request, display casing, no `#`. */
export interface TagRename {
  readonly from: string
  readonly to: string
}

/** Why `rename` cannot run, for the field under the input, or `null` when it can. */
export function tagRenameProblem(rename: TagRename): string | null {
  const to = normalizeTagInput(rename.to)
  if (to === '') {
    return 'Type a name.'
  }
  if (!isTagName(to)) {
    return 'Use letters, numbers, / _ and - only, starting with a letter.'
  }
  if (to === normalizeTagInput(rename.from)) {
    return 'That is the current name.'
  }
  return null
}

/** A tag as typed in a field: trimmed, without leading `#`. */
export function normalizeTagInput(value: string): string {
  return value.trim().replace(/^#+/, '')
}

/**
 * The new name of `tag` under `rename` (the tag itself or one nested under
 * it), or `null` when the rename does not reach it. Matching is folded like
 * the index; the new name keeps the casing the user typed, and a nested
 * tag keeps its own suffix as written.
 */
export function renamedTagName(tag: string, rename: TagRename): string | null {
  const from = foldTag(normalizeTagInput(rename.from))
  const to = normalizeTagInput(rename.to)
  const key = foldTag(tag)
  if (key === from) {
    return to
  }
  if (key.startsWith(`${from}/`)) {
    return `${to}${tag.slice(from.length)}`
  }
  return null
}

/**
 * `source` with the tag renamed in frontmatter `tags:` and in body
 * `#hashtags`, or `null` when the note does not carry it. Also rewrites a
 * definition's `extends:` and relation `target:` values, which only tag
 * definitions carry.
 */
export function renameTagInSource(source: string, rename: TagRename): string | null {
  const rewrite = (name: string): string | null => renamedTagName(name, rename)
  const afterFrontmatter = renameFrontmatterTags(source, rewrite) ?? source
  // The body scan costs about 2 ms per note on a real vault; most notes carry
  // a type in frontmatter only, so skip it when no `#from` appears at all.
  const mention = `#${foldTag(normalizeTagInput(rename.from))}`
  const afterBody = foldTag(afterFrontmatter).includes(mention)
    ? (renameBodyTags(afterFrontmatter, rewrite) ?? afterFrontmatter)
    : afterFrontmatter
  return afterBody === source ? null : afterBody
}

/** One text replacement inside the frontmatter, in source offsets. */
interface Edit {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** A tag token inside a scalar's source text: optional `#`, then the name. */
const TOKEN = /(^|[\s,"'[])#?(\p{L}[\p{L}\p{N}/_-]*)/gu

function renameFrontmatterTags(
  source: string,
  rewrite: (name: string) => string | null,
): string | null {
  const { raw } = splitFrontmatter(source)
  if (raw === null) {
    return null
  }
  const doc = parseDocument(raw)
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return null
  }
  const rawStart = source.indexOf('\n') + 1
  const edits: Edit[] = []
  const tags = doc.get('tags', true)
  if (isSeq(tags)) {
    renameSeq(raw, tags, rewrite, edits)
  } else if (isScalar(tags)) {
    renameScalar(raw, tags, rewrite, edits)
  }
  const parents = doc.get('extends', true)
  if (isSeq(parents)) {
    renameSeq(raw, parents, rewrite, edits)
  } else if (isScalar(parents)) {
    renameScalar(raw, parents, rewrite, edits)
  }
  const properties = doc.get('properties', true)
  if (isSeq(properties)) {
    for (const item of properties.items) {
      if (!isMap(item)) {
        continue
      }
      const target = item.get('target', true)
      if (isScalar(target)) {
        renameScalar(raw, target, rewrite, edits)
      }
    }
  }
  if (edits.length === 0) {
    return null
  }
  let next = raw
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  }
  return source.slice(0, rawStart) + next + source.slice(rawStart + raw.length)
}

/** Rewrite the tag tokens of one scalar's source text in place. */
function renameScalar(
  raw: string,
  node: Scalar,
  rewrite: (name: string) => string | null,
  edits: Edit[],
): void {
  const range = node.range
  if (range === null || range === undefined || typeof node.value !== 'string') {
    return
  }
  const [start, end] = range
  const text = raw.slice(start, end)
  let changed = false
  const next = text.replaceAll(TOKEN, (whole: string, _lead: string, name: string) => {
    const renamed = rewrite(name)
    if (renamed === null || renamed === name) {
      return whole
    }
    changed = true
    // `whole` is the delimiter, an optional `#`, then the name: keep the first two.
    return `${whole.slice(0, whole.length - name.length)}${renamed}`
  })
  if (changed) {
    edits.push({ start, end, text: next })
  }
}

/**
 * Rewrite a list's tag entries, then drop an entry the rename turned into a
 * duplicate of an earlier one (a merge). Dropping removes the item's own
 * source: its whole line in a block list, the item and one separating comma
 * in a flow list.
 */
function renameSeq(
  raw: string,
  seq: YAMLSeq,
  rewrite: (name: string) => string | null,
  edits: Edit[],
): void {
  const seen = new Set<string>()
  for (const item of seq.items) {
    if (!isScalar(item) || typeof item.value !== 'string') {
      continue
    }
    const name = item.value.trim().replace(/^#+/, '')
    const renamed = isTagName(name) ? (rewrite(name) ?? name) : name
    const key = foldTag(renamed)
    if (seen.has(key)) {
      const removal = itemRemoval(raw, item, seq.flow === true)
      if (removal !== null) {
        edits.push(removal)
        continue
      }
    }
    seen.add(key)
    renameScalar(raw, item, rewrite, edits)
  }
}

function itemRemoval(raw: string, item: Scalar, flow: boolean): Edit | null {
  const range = item.range
  if (range === null || range === undefined) {
    return null
  }
  const [start, end] = range
  if (flow) {
    // A duplicate is never the first item, so a comma precedes it.
    let cut = start
    while (cut > 0 && /\s/.test(raw[cut - 1]!)) {
      cut -= 1
    }
    if (raw[cut - 1] !== ',') {
      return null
    }
    return { start: cut - 1, end, text: '' }
  }
  const lineStart = raw.lastIndexOf('\n', start - 1) + 1
  if (!/^\s*-\s*$/.test(raw.slice(lineStart, start))) {
    return null
  }
  const newline = raw.indexOf('\n', end)
  if (raw.slice(end, newline === -1 ? raw.length : newline).trim() !== '') {
    return null
  }
  if (newline === -1) {
    // The frontmatter's last line has no newline of its own (the closing
    // fence owns it), so take the one before it instead.
    return { start: Math.max(lineStart - 1, 0), end: raw.length, text: '' }
  }
  return { start: lineStart, end: newline + 1, text: '' }
}

/** One note the rename rewrites: its bytes when read, and after. */
export interface TagRenameWrite {
  readonly path: string
  readonly before: string
  readonly after: string
}

/** A type definition that moves to its renamed tag's path. */
export interface TagDefinitionMove {
  readonly from: string
  readonly to: string
}

/** What a rename will do, computed before anything is written. */
export interface TagRenamePlan {
  readonly writes: readonly TagRenameWrite[]
  readonly moves: readonly TagDefinitionMove[]
  /**
   * Definitions that stay where they are because the renamed tag already has
   * its own (a merge of two types): the target's fields win, and these
   * paths are named in the preview so nothing disappears silently.
   */
  readonly keptDefinitions: readonly string[]
  /** Nested tags that follow the rename, new names, display casing. */
  readonly nestedTags: readonly string[]
  /** True when the new name is already a tag: the two become one. */
  readonly merges: boolean
}

/** What {@link planTagRename} reads; the caller gathers it from the index. */
export interface TagRenameInput {
  /** Every note that may mention the tag, with its current bytes. */
  readonly notes: readonly { readonly path: string; readonly source: string }[]
  /** The vault's type definitions, by folded tag. */
  readonly definitions: readonly {
    readonly tagKey: string
    readonly notePath: string
  }[]
  /** Every tag in use, display casing. */
  readonly tags: readonly string[]
}

/** Plan `rename` over `input`. Pure: nothing is read or written. */
export function planTagRename(rename: TagRename, input: TagRenameInput): TagRenamePlan {
  const writes: TagRenameWrite[] = []
  for (const note of input.notes) {
    const after = renameTagInSource(note.source, rename)
    if (after !== null) {
      writes.push({ path: note.path, before: note.source, after })
    }
  }
  const fromKey = foldTag(normalizeTagInput(rename.from))
  const usedKeys = new Set(input.tags.map(foldTag))
  const definedKeys = new Set(input.definitions.map((entry) => entry.tagKey))
  // A destination that is itself renamed away (`a → a/b` moving `a/b` on to
  // `a/b/b`) is not an occupied one.
  const occupied = (keys: ReadonlySet<string>, key: string): boolean =>
    keys.has(key) && renamedTagName(key, rename) === null
  const nestedTags: string[] = []
  let merges = false
  for (const tag of input.tags) {
    const renamed = renamedTagName(tag, rename)
    if (renamed === null) {
      continue
    }
    if (foldTag(tag) !== fromKey) {
      nestedTags.push(renamed)
    }
    if (foldTag(renamed) !== foldTag(tag) && occupied(usedKeys, foldTag(renamed))) {
      merges = true
    }
  }
  const moves: TagDefinitionMove[] = []
  const keptDefinitions: string[] = []
  for (const definition of input.definitions) {
    const renamed = renamedTagName(definition.tagKey, rename)
    if (renamed === null) {
      continue
    }
    const destination = tagDefinitionPath(renamed)
    if (destination === definition.notePath) {
      continue // a change of casing only: the folded path stays
    }
    if (occupied(definedKeys, foldTag(renamed))) {
      keptDefinitions.push(definition.notePath)
      continue
    }
    moves.push({ from: definition.notePath, to: destination })
  }
  return {
    writes,
    moves,
    keptDefinitions,
    nestedTags: nestedTags.sort(),
    merges,
  }
}
