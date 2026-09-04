import {
  appendBodyTag,
  createNoteIfAbsent,
  createNoteWithTitle,
  createdStampValues,
  expandTemplatePlaceholders,
  isTemplatePath,
  newNoteId,
  readNote,
  splitFrontmatter,
  untitledNotePath,
  untitledNoteSeed,
  upsertFrontmatter,
  type TagType,
  type TemplatePlaceholderValues,
} from '@reflect/core'

/**
 * Birth a note as a collection row: untitled seed (or the type's bound
 * template), the tag in the body, and any property values the view already
 * knows (a board lane, a calendar day). The path is returned so the caller
 * can open it.
 */
export async function createCollectionNote(
  tag: string,
  generation: number,
  properties: Record<string, unknown> = {},
  body = untitledNoteSeed(),
): Promise<string> {
  const path = untitledNotePath()
  const tagged = appendBodyTag(body, tag) ?? body
  const seed = Object.keys(properties).length === 0 ? tagged : upsertFrontmatter(tagged, properties)
  await createNoteIfAbsent(path, seed, generation)
  return path
}

/**
 * {@link createCollectionNote} seeded from the tag type's bound template
 * when it names one. Callers that already have the type (board, calendar)
 * pass it so we don't hit the index again.
 */
export async function createTypedCollectionNote(
  tag: string,
  generation: number,
  properties: Record<string, unknown>,
  type: TagType | null | undefined,
  values: TemplatePlaceholderValues,
): Promise<string> {
  return await createCollectionNote(
    tag,
    generation,
    // A row born in the app carries its `created` stamps (Plan 29 T1);
    // values the caller already set (a lane, a day) win over the stamp.
    { ...createdStampValues(type), ...properties },
    await bodyForCollectionCreate(type, values, generation),
  )
}

/**
 * Birth a row already titled — the table's "+ New" line: a note named
 * `title` at a slug path (like every create-from-title), carrying the tag,
 * the type's `created` stamps, and its bound template's body with the
 * title expanded into it. Returns the path.
 */
export async function createTitledCollectionNote(
  tag: string,
  generation: number,
  title: string,
  type: TagType | null | undefined,
  values: TemplatePlaceholderValues,
): Promise<string> {
  const body = await bodyForCollectionCreate(type, { ...values, title }, generation)
  const stamps = createdStampValues(type)
  const seeded = Object.keys(stamps).length === 0 ? body : upsertFrontmatter(body, stamps)
  return await createNoteWithTitle(title, generation, appendBodyTag(seeded, tag) ?? seeded)
}

/**
 * Body for a new collection row: the type's bound template with placeholders
 * expanded, or the untitled seed when the type names none (or the file is
 * missing). The untitled seed's `id:` is kept so the new note is born with
 * durable identity either way.
 */
export async function bodyForCollectionCreate(
  type: TagType | null | undefined,
  values: TemplatePlaceholderValues,
  generation: number,
): Promise<string> {
  const path = type?.template
  if (path === undefined || !isTemplatePath(path)) {
    return untitledNoteSeed()
  }
  try {
    const expanded = expandTemplatePlaceholders(
      splitFrontmatter(await readNote(path, generation)).body,
      values,
    )
    return upsertFrontmatter(expanded, { id: newNoteId() })
  } catch {
    return untitledNoteSeed()
  }
}
