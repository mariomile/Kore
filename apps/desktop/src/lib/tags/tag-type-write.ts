import {
  createNoteIfAbsent,
  parseNote,
  parseTagTypeFrontmatter,
  TAG_TYPE_MARKER,
  tagDefinitionPath,
  upsertFrontmatter,
  type TagProperty,
} from '@reflect/core'
import { commitNoteFrontmatter, readNoteSource } from '@/lib/note-frontmatter'

/**
 * Reading and writing tag definition notes (TDR 0005). The schema lives in
 * `tags/<key>.md` frontmatter (`lore: tag` + `properties`); saves ride the
 * typed `tagSchema` patch through the shared session-or-disk channel, so a
 * definition note open with unsaved edits takes the schema into its live
 * header instead of a disk write racing the buffer. Either way the write is
 * minimal-diff (`upsertFrontmatter`): comments, unknown keys, and the body
 * survive, and broken YAML refuses rather than rewriting.
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
  /** Bound template path for new rows, or `null` when the type names none. */
  template: string | null
}

/** Read the tag's definition state for the config dialog. */
export async function readTagDefinition(tag: string): Promise<TagDefinitionState> {
  const path = tagDefinitionPath(tag)
  let source: string
  try {
    source = await readNoteSource(path)
  } catch {
    return { path, exists: false, needsConversion: false, properties: [], template: null }
  }
  const type = parseTagTypeFrontmatter(parseNote({ path, source }).frontmatter)
  return {
    path,
    exists: true,
    needsConversion: type === null,
    properties: type?.properties ?? [],
    template: type?.template ?? null,
  }
}

/**
 * Persist a tag's schema: create `tags/<key>.md` when missing, else commit
 * the marker + `properties` as a `tagSchema` frontmatter patch (the
 * conversion confirm happens in the dialog, before this runs).
 * `upsertFrontmatter` refuses a file whose YAML is broken — the caller
 * surfaces that instead of destroying anything.
 */
export async function saveTagType(
  tag: string,
  properties: readonly TagProperty[],
  generation: number,
  template: string | null = null,
): Promise<void> {
  const path = tagDefinitionPath(tag)
  const seed = upsertFrontmatter('', {
    lore: TAG_TYPE_MARKER,
    properties: properties.map((property) => ({
      name: property.name,
      key: property.key,
      type: property.type,
      ...(property.options === undefined ? {} : { options: property.options }),
      ...(property.rollup === undefined ? {} : { rollup: property.rollup }),
    })),
    ...(template === null ? {} : { template }),
  })
  const created = await createNoteIfAbsent(path, seed, generation)
  if (created.kind === 'created') {
    return
  }
  await commitNoteFrontmatter(path, { tagSchema: properties, tagTemplate: template }, generation)
}
