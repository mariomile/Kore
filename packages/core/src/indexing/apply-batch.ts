import { errorMessage } from '../errors'
import { applyIndexedNotes, touchIndexedNotes, type IndexedNoteTouch } from './commands'
import type { IndexedNote } from './indexed-note'

/**
 * Notes per `index_apply_batch` transaction in the bulk passes (rebuild,
 * reconcile, and large watcher batches). Bounds the IPC payload and
 * transaction size on large graphs while keeping the transaction/round-trip
 * count far below one-per-note.
 */
export const INDEX_APPLY_BATCH_SIZE = 256

/** One note omitted from a rebuild because its projection could not be written. */
export interface SkippedIndexedNote {
  /** Graph-relative markdown path. */
  path: string
  /** Displayable reason from the failed write. */
  message: string
}

/**
 * Apply `notes` in one transaction, splitting a refused batch in half until
 * the failing note stands alone — one bad projection must not cost the rest
 * of the batch. The lone failure reports through `onSkippedNote`, or throws
 * without one. Returns how many notes were actually written.
 */
async function applySplitBatch(
  notes: IndexedNote[],
  generation: number,
  onSkippedNote?: (note: SkippedIndexedNote) => void,
): Promise<number> {
  if (notes.length === 0) {
    return 0
  }
  try {
    await applyIndexedNotes(notes, generation)
    return notes.length
  } catch (cause) {
    if (notes.length === 1) {
      if (onSkippedNote === undefined) {
        throw cause
      }
      onSkippedNote({ path: notes[0]!.path, message: errorMessage(cause) })
      return 0
    }
    const midpoint = Math.ceil(notes.length / 2)
    const first = await applySplitBatch(notes.slice(0, midpoint), generation, onSkippedNote)
    return first + (await applySplitBatch(notes.slice(midpoint), generation, onSkippedNote))
  }
}

/** A shared accumulator for bulk index writes — see {@link createIndexApplyBatch}. */
export interface IndexApplyBatch {
  /** Queue a projection; flushes automatically at the transaction cap. */
  add: (note: IndexedNote) => Promise<void>
  /** Apply everything still queued. Safe to call repeatedly. */
  flush: () => Promise<void>
  /** Projections actually written so far (skipped notes excluded). */
  applied: () => number
}

/**
 * The one write path for the bulk index passes (rebuild, reconcile, watcher
 * batches): accumulate projections, apply them in shared
 * `index_apply_batch` transactions of {@link INDEX_APPLY_BATCH_SIZE}, and
 * degrade refused batches through {@link applySplitBatch}'s halving retry so
 * failures attribute to single notes. Callers own *when* to flush early —
 * e.g. before a remove that must not be overtaken by queued upserts.
 */
export function createIndexApplyBatch(
  generation: number,
  onSkippedNote?: (note: SkippedIndexedNote) => void,
): IndexApplyBatch {
  let batch: IndexedNote[] = []
  let appliedCount = 0
  async function flush(): Promise<void> {
    if (batch.length === 0) {
      return
    }
    const notes = batch
    batch = []
    appliedCount += await applySplitBatch(notes, generation, onSkippedNote)
  }
  return {
    add: async (note) => {
      batch.push(note)
      if (batch.length >= INDEX_APPLY_BATCH_SIZE) {
        await flush()
      }
    },
    flush,
    applied: () => appliedCount,
  }
}

/** A shared accumulator for mtime re-stamps — see {@link createMtimeTouchBatch}. */
export interface MtimeTouchBatch {
  /** Queue a re-stamp; flushes automatically at the transaction cap. */
  add: (entry: IndexedNoteTouch) => Promise<void>
  /** Apply everything still queued. Safe to call repeatedly. */
  flush: () => Promise<void>
  /** Re-stamps actually written so far. */
  applied: () => number
}

/**
 * Accumulate mtime re-stamps for hash-match skips (the self-heal for rows
 * whose stored mtime was an echo-time stamp — see {@link touchIndexedNotes})
 * and apply them in shared `index_touch` transactions of
 * {@link INDEX_APPLY_BATCH_SIZE}. Both bulk skip paths (reconcile, watcher
 * batch) share this shape, mirroring {@link createIndexApplyBatch}.
 */
export function createMtimeTouchBatch(generation: number): MtimeTouchBatch {
  let batch: IndexedNoteTouch[] = []
  let appliedCount = 0
  async function flush(): Promise<void> {
    if (batch.length === 0) {
      return
    }
    const entries = batch
    batch = []
    await touchIndexedNotes(entries, generation)
    appliedCount += entries.length
  }
  return {
    add: async (entry) => {
      batch.push(entry)
      if (batch.length >= INDEX_APPLY_BATCH_SIZE) {
        await flush()
      }
    },
    flush,
    applied: () => appliedCount,
  }
}
