import {
  getPathLinkSources,
  hasBridge,
  readNote,
  rewritePathLinksForMove,
  writeNote,
} from '@kore/core'
import { openSession } from '@/editor/open-documents'

export interface MovedNotePath {
  readonly from: string
  readonly to: string
}

/**
 * Rewrite inbound explicit-path wikilinks (`[[OldFolder/Note]]`) after one or
 * more note files have moved on disk. Best-effort per moved note: dirty open
 * sessions are skipped rather than overwritten, and a failing source logs and
 * leaves remaining moves unaffected.
 */
export async function rewriteMovedNotePathLinks(
  moves: readonly MovedNotePath[],
  generation: number,
): Promise<void> {
  if (moves.length === 0 || !hasBridge()) {
    return
  }
  const io = {
    pathLinkSources: getPathLinkSources,
    read: (path: string) => readNote(path, generation),
    write: async (path: string, content: string) => {
      if (openSession(path)?.isDirty() === true) {
        return
      }
      await writeNote(path, content, generation)
    },
  }
  for (const { from, to } of moves) {
    try {
      await rewritePathLinksForMove(from, to, io)
    } catch (cause) {
      console.warn(`path-link rewrite skipped for ${from} -> ${to}:`, cause)
    }
  }
}
