import {
  appendBodyTag,
  createNoteIfAbsent,
  untitledNotePath,
  untitledNoteSeed,
  upsertFrontmatter,
} from '@reflect/core'

/**
 * Birth a note as a collection row: untitled seed, the tag in the body, and
 * any property values the view already knows (a board lane, a calendar day).
 * The path is returned so the caller can open it. When the tag type names a
 * template, the caller passes that expanded body in as `body`.
 */
export async function createCollectionNote(
  tag: string,
  generation: number,
  properties: Record<string, unknown> = {},
  body = untitledNoteSeed(),
): Promise<string> {
  const path = untitledNotePath()
  const tagged = appendBodyTag(body, tag) ?? body
  const seed =
    Object.keys(properties).length === 0 ? tagged : upsertFrontmatter(tagged, properties)
  await createNoteIfAbsent(path, seed, generation)
  return path
}
