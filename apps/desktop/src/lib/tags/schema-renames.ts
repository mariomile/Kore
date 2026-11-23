import {
  listNotesWithProperty,
  optionRenameMap,
  propertyRowValue,
  renameOptionValue,
  type CollectionValue,
  type OptionChange,
} from '@kore/core'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'

/**
 * Property-key renames and the values they would orphan. A schema edit that
 * changes a property's frontmatter key leaves every note's stored value
 * under the old key: the values are still on disk but nothing reads them.
 * So a rename is always *planned* first — how many notes carry the old key —
 * and migrated only when the user says so.
 *
 * Extracted from the Configure-tag dialog so the chat proposal card
 * (`set_tag_schema`) lands a rename through the same two steps, rather than
 * the second copy of this logic that the dialog's `performSave` used to be.
 */

/** One planned rename: the keys, and the notes still carrying the old one. */
export interface PendingRename {
  from: string
  to: string
  notes: { notePath: string; value: CollectionValue }[]
}

/**
 * Which of `renames` actually touch stored values. A rename no note carries
 * needs no decision — the schema save alone finishes it — so it drops here
 * and never reaches the user.
 */
export async function planPropertyRenames(
  renames: readonly { from: string; to: string }[],
): Promise<PendingRename[]> {
  const planned = await Promise.all(
    renames.map(async ({ from, to }) => ({
      from,
      to,
      notes: await listNotesWithProperty(from),
    })),
  )
  return planned.filter((rename) => rename.notes.length > 0)
}

/**
 * Move each note's value from the old key to the new one, through the
 * ordinary frontmatter patch channel — the same write an inline cell edit
 * makes, one note at a time, so an open note takes it in its live header.
 */
export async function migratePropertyRenames(
  renames: readonly PendingRename[],
  generation: number,
): Promise<void> {
  for (const rename of renames) {
    for (const note of rename.notes) {
      await commitNoteFrontmatter(
        note.notePath,
        {
          properties: {
            [rename.from]: undefined,
            [rename.to]: propertyRowValue(note.value),
          },
        },
        generation,
      )
    }
  }
}

/** One property's option changes, to land on the type's member notes. */
export interface OptionRenames {
  /** The property's frontmatter key as saved. */
  key: string
  /** Renames, merges (a rename onto another option) and removals (`to: null`). */
  renames: readonly OptionChange[]
}

/**
 * Rewrite the option values a type settings save renamed, merged or
 * deleted, on the type's own member notes only (another type may use the
 * same key and the same words with its own meaning). Unlike a key rename
 * there is nothing left to decide at save time: the user renamed the option
 * or chose where a deleted one's notes go, and a note left on the old text
 * would just fall out of the list. A note left without a value loses the
 * property. Returns how many notes changed.
 */
export async function migrateOptionRenames(
  tag: string,
  properties: readonly OptionRenames[],
  generation: number,
): Promise<number> {
  let changed = 0
  for (const { key, renames } of properties) {
    const map = optionRenameMap(renames)
    if (map.size === 0) {
      continue
    }
    for (const note of await listNotesWithProperty(key, { tag })) {
      const next = renameOptionValue(propertyRowValue(note.value), map)
      if (next === undefined) {
        continue
      }
      await commitNoteFrontmatter(
        note.notePath,
        { properties: { [key]: next === null ? undefined : next } },
        generation,
      )
      changed += 1
    }
  }
  return changed
}
