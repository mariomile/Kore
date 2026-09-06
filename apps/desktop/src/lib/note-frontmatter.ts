import { upsertFrontmatter, writeNote } from '@reflect/core'
import { frontmatterPatchToYaml, type FrontmatterPatch } from '@/editor/note-session'
import { openSession } from '@/editor/open-documents'
import { readNoteOrEmpty } from '@/lib/note-read'

/**
 * The single safe way to read and write a note's frontmatter from an in-app
 * action (pin, private, gist publish). Each used to hand-roll the same
 * session-or-disk dance; the two sharp edges live here once instead of three
 * times:
 *
 * - **Reads** prefer the open session's *loaded* buffer, never a still-loading
 *   one. A loading session reports `liveContent() === null` (its empty buffer
 *   isn't the truth yet), so we fall back to disk rather than act on a
 *   placeholder — the trap behind empty publishes and mis-read toggle states.
 * - **Writes** go through the session when it can take the patch (so our own
 *   write never parks a conflict under a dirty buffer), else a read-patch-write
 *   on disk that a loading/clean session reconciles like any external edit.
 *   Both encode the flag through {@link frontmatterPatchToYaml}, so a value
 *   lands identically whichever channel wins.
 */

/**
 * The note's current source, read from the freshest authoritative place: the
 * open session's loaded buffer, or disk when no session has it loaded.
 */
export async function readNoteSource(path: string): Promise<string> {
  return openSession(path)?.liveContent() ?? (await readNoteOrEmpty(path))
}

/**
 * Land `patch` on the note's frontmatter, returning once it has persisted.
 * Routes through the live session when one can take the patch; otherwise
 * patches disk directly. A patch that changes nothing is a no-op.
 */
export async function commitNoteFrontmatter(
  path: string,
  patch: FrontmatterPatch,
  generation: number,
): Promise<void> {
  const owner = openSession(path)
  if (owner !== null && (await owner.commitFrontmatter(patch))) {
    return
  }
  const onDisk = await readNoteOrEmpty(path)
  const patched = upsertFrontmatter(onDisk, frontmatterPatchToYaml(patch))
  if (patched !== onDisk) {
    await writeNote(path, patched, generation)
  }
}

/**
 * Land a body rewrite on the note, returning once it has persisted. Routes
 * through the live session when the note is open (so unsaved edits survive
 * and the editor updates in place); otherwise transforms disk directly.
 * A rewrite that changes nothing is a no-op.
 */
export async function commitNoteBodyTransform(
  path: string,
  transform: (source: string) => string,
  generation: number,
): Promise<void> {
  const owner = openSession(path)
  if (owner !== null) {
    if (await owner.commitBodyTransform(transform)) {
      return
    }
    throw new Error('The note is open and cannot take this edit right now.')
  }
  const onDisk = await readNoteOrEmpty(path)
  const next = transform(onDisk)
  if (next !== onDisk) {
    await writeNote(path, next, generation)
  }
}
