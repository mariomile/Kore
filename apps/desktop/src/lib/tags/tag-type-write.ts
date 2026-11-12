import {
  createNoteIfAbsent,
  foldTag,
  parseNote,
  tagExtendsLoop,
  parseTagTypeFrontmatter,
  tagDefinitionPath,
  upsertFrontmatter,
  type SavedCollectionView,
  type TagProperty,
} from '@kore/core'
import { commitNoteFrontmatter, readNoteSource } from '@/lib/note-frontmatter'
import { frontmatterPatchToYaml } from '@/editor/note-session'

/**
 * Reading and writing tag definition notes (TDR 0005). The schema lives in
 * `tags/<key>.md` frontmatter (`kore: tag` + `properties`); saves ride the
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
   * The existing file lacks the `kore: tag` marker — a pre-existing user
   * note. Saving over it is a *conversion* the user must confirm.
   */
  needsConversion: boolean
  /** The current schema (empty for a missing or unmarked definition). */
  properties: TagProperty[]
  /** Bound template path for new rows, or `null` when the type names none. */
  template: string | null
  /** The tag's emoji glyph, or `null` when the definition sets none. */
  icon: string | null
  /** The tags this one builds on (`extends:`, Plan 33 B2), folded keys. */
  parents: string[]
  /** The type's saved database views (`views:`), in tab order; absent = none. */
  views?: SavedCollectionView[]
}

/** Read the tag's definition state for the config dialog. */
export async function readTagDefinition(tag: string): Promise<TagDefinitionState> {
  const path = tagDefinitionPath(tag)
  let source: string
  try {
    source = await readNoteSource(path)
  } catch {
    source = ''
  }
  // A missing note reads as empty: there is nothing to convert either way.
  if (source.trim() === '') {
    return {
      path,
      exists: false,
      needsConversion: false,
      properties: [],
      template: null,
      icon: null,
      parents: [],
      views: [],
    }
  }
  const type = parseTagTypeFrontmatter(parseNote({ path, source }).frontmatter)
  return {
    path,
    exists: true,
    needsConversion: type === null,
    properties: type?.properties ?? [],
    template: type?.template ?? null,
    icon: type?.icon ?? null,
    parents: [...(type?.extends ?? [])],
    views: [...(type?.views ?? [])],
  }
}

/**
 * The rest of a definition `saveTagType` can write. Each one is written
 * only when given (`null` clears it), so a one-gesture edit that knows
 * nothing about, say, the icon can never wipe it.
 */
export interface TagTypeExtras {
  template?: string | null
  icon?: string | null
  /** The `extends:` list (Plan 33 B2). */
  parents?: readonly string[]
  /** The saved database views (`views:`), replaced whole. */
  views?: readonly SavedCollectionView[]
}

/**
 * Persist a tag's schema: create `tags/<key>.md` when missing, else commit
 * the marker + `properties` as a `tagSchema` frontmatter patch (the
 * conversion confirm happens in the dialog, before this runs).
 * `upsertFrontmatter` refuses a file whose YAML is broken — the caller
 * surfaces that instead of destroying anything. Parents that would close a
 * loop are refused before anything is written.
 */
export async function saveTagType(
  tag: string,
  properties: readonly TagProperty[],
  generation: number,
  { template, icon, parents, views }: TagTypeExtras = {},
): Promise<void> {
  if (parents !== undefined) {
    const loop = await tagExtendsLoop(tag, parents)
    if (loop !== null) {
      throw new Error(
        loop === foldTag(tag)
          ? `#${foldTag(tag)} can't build on itself.`
          : `#${foldTag(tag)} can't build on #${loop}: #${loop} already builds on #${foldTag(tag)}.`,
      )
    }
  }
  const patch = {
    tagSchema: properties,
    ...(template === undefined ? {} : { tagTemplate: template }),
    ...(icon === undefined ? {} : { icon }),
    ...(parents === undefined ? {} : { tagExtends: parents }),
    ...(views === undefined ? {} : { tagViews: views }),
  }
  const path = tagDefinitionPath(tag)
  // The seed rides the SAME serializer as the update path below — a schema
  // field spelled in one place only. This exact fork once dropped `target`
  // (and later `formula`) from freshly created collections while updates
  // kept them.
  const seed = upsertFrontmatter('', frontmatterPatchToYaml(patch))
  const created = await createNoteIfAbsent(path, seed, generation)
  if (created.kind === 'created') {
    return
  }
  await commitNoteFrontmatter(path, patch, generation)
}

/**
 * Persist a type's saved database views into its definition note
 * (`views:`), the same session-or-disk channel as the schema so an open
 * definition takes them into its live header. Only an existing, marked
 * definition is written: an untyped tag keeps its views in local settings,
 * and saving a tab must never turn a plain tag into a type behind the
 * user's back.
 */
export async function saveTagViews(
  tag: string,
  views: readonly SavedCollectionView[],
  generation: number,
): Promise<void> {
  await commitNoteFrontmatter(tagDefinitionPath(tag), { tagViews: views }, generation)
}
