import {
  createNoteIfAbsent,
  parseNote,
  parseTagTypeFrontmatter,
  TAG_TYPE_MARKER,
  tagDefinitionPath,
  upsertFrontmatter,
  writeNote,
  type TagProperty,
} from '@reflect/core'
import { readNoteSource } from '@/lib/note-frontmatter'

/**
 * Reading and writing tag definition notes (TDR 0005). The schema lives in
 * `tags/<key>.md` frontmatter (`lore: tag` + `properties`), so saves go
 * through `upsertFrontmatter` — minimal-diff, comments and unknown keys
 * survive — never through `FrontmatterPatch`, whose reserved-key guard
 * exists precisely to keep these keys out of property writes.
 */

/** What the config dialog found at the tag's definition path. */
export interface TagDefinitionState {
  /** `tags/<folded-key>.md`. */
  path: string
  /** A file exists at the path. */
  exists: boolean
  /**
   * The existing file lacks the `lore: tag` marker — a pre-existing user
   * note. Saving over it is a *conversion* the user must confirm.
   */
  needsConversion: boolean
  /** The current schema (empty for a missing or unmarked definition). */
  properties: TagProperty[]
}

/** Read the tag's definition state for the config dialog. */
export async function readTagDefinition(tag: string): Promise<TagDefinitionState> {
  const path = tagDefinitionPath(tag)
  let source: string
  try {
    source = await readNoteSource(path)
  } catch {
    return { path, exists: false, needsConversion: false, properties: [] }
  }
  const type = parseTagTypeFrontmatter(parseNote({ path, source }).frontmatter)
  return {
    path,
    exists: true,
    needsConversion: type === null,
    properties: type?.properties ?? [],
  }
}

/**
 * Persist a tag's schema: create `tags/<key>.md` when missing, else patch the
 * marker + `properties` into the existing file (the conversion confirm
 * happens in the dialog, before this runs). `upsertFrontmatter` refuses a
 * file whose YAML is broken — the caller surfaces that instead of destroying
 * anything.
 */
export async function saveTagType(
  tag: string,
  properties: readonly TagProperty[],
  generation: number,
): Promise<void> {
  const path = tagDefinitionPath(tag)
  const patch = {
    lore: TAG_TYPE_MARKER,
    properties: properties.map((property) => ({
      name: property.name,
      key: property.key,
      type: property.type,
      ...(property.options === undefined ? {} : { options: property.options }),
    })),
  }
  const created = await createNoteIfAbsent(path, upsertFrontmatter('', patch), generation)
  if (created.kind === 'created') {
    return
  }
  const source = await readNoteSource(path)
  const next = upsertFrontmatter(source, patch)
  if (next !== source) {
    await writeNote(path, next, generation)
  }
}
