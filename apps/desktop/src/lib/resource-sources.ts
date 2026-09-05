import { parseNote, readNote, upsertFrontmatter, writeNote } from '@reflect/core'
import { z } from 'zod'
import { openSession } from '@/editor/open-documents'
import type { NoteSession } from '@/editor/note-session'

const sourcesSchema = z.array(z.string())

/** Append an origin without racing an open card's annotations or crossing graph sessions. */
export async function appendResourceSource(
  path: string,
  sourceLink: string,
  generation: number,
  isStale: () => boolean,
): Promise<void> {
  const assertCurrent = (): void => {
    if (isStale()) throw new Error('The resource origin session has ended')
  }
  const nextSources = (source: string): string[] | null => {
    const sources = sourcesSchema.parse(parseNote({ path, source }).frontmatter['sources'] ?? [])
    return sources.includes(sourceLink) ? null : [...sources, sourceLink]
  }
  const updateOwner = async (owner: NoteSession): Promise<void> => {
    assertCurrent()
    const content = owner.liveContent()
    if (content === null) throw new Error('The resource card is still loading')
    const sources = nextSources(content)
    if (sources === null) return
    assertCurrent()
    if (!(await owner.commitFrontmatter({ properties: { sources } }))) {
      throw new Error('The resource card cannot accept source updates')
    }
  }
  assertCurrent()
  const owner = openSession(path)
  if (owner !== null) return await updateOwner(owner)
  const source = await readNote(path, generation)
  assertCurrent()
  // A card can open while the disk read is in flight.
  const reopened = openSession(path)
  if (reopened !== null) return await updateOwner(reopened)
  const sources = nextSources(source)
  if (sources !== null) {
    await writeNote(path, upsertFrontmatter(source, { sources }), generation)
  }
}
