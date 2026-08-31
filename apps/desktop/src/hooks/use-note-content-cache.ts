import { useCallback, useEffect, useRef } from 'react'
import { subscribeOwnWrites, type FileChange } from '@reflect/core'
import { enableNoteContentCache, invalidateCachedNote } from '@/editor/note-content-cache'
import { useFileChanges } from '@/lib/use-file-changes'

/** How long after our own save a watcher event still counts as its echo. */
const OWN_WRITE_TTL_MS = 5_000

/**
 * Mounts the note-content cache for one graph: switches serving on, drops
 * entries when the watcher reports a change, and clears everything when the
 * graph closes or switches (the effect is keyed on `root`; paths are
 * graph-relative, so entries must never survive into another graph).
 *
 * Watcher events for this device's own saves are skipped, mirroring the
 * iCloud controller's own-write bookkeeping: the save path already recorded
 * the written content, and invalidating on the echo would leave every
 * just-edited note cold. The window is a TTL, not exact bookkeeping — a
 * genuinely external change racing our save within it still self-heals,
 * because a warm open always verifies against disk before trusting what it
 * served.
 */
export function useNoteContentCache(root: string): void {
  useEffect(() => enableNoteContentCache(), [root])

  const ownWrites = useRef(new Map<string, number>())
  useEffect(
    () =>
      subscribeOwnWrites((path) => {
        ownWrites.current.set(path, Date.now())
      }),
    [],
  )

  const onChanges = useCallback((changes: FileChange[]) => {
    const now = Date.now()
    for (const [path, stamp] of ownWrites.current) {
      if (now - stamp > OWN_WRITE_TTL_MS) {
        ownWrites.current.delete(path)
      }
    }
    for (const change of changes) {
      if (change.kind === 'upsert' && ownWrites.current.has(change.path)) {
        continue
      }
      invalidateCachedNote(change.path)
    }
  }, [])
  useFileChanges(onChanges)
}
