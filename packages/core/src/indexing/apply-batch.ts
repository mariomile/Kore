import { errorMessage } from '../errors'
import { applyIndexedNotes, touchIndexedNotes, type IndexedNoteTouch } from './commands'
import type { IndexedNote } from './indexed-note'

/**
 * Notes per `index_apply_batch` transaction in the bulk passes (rebuild,
 * reconcile, and large watcher batches). Bounds the IPC payload and
 * transaction size on large graphs while keeping the transaction/round-trip
 * count far below one-per-note.
 *
 * A count alone is a poor bound on *memory*: an accumulated batch holds every
 * queued {@link IndexedNote} whole — note text, asset descriptions, preview,
 * and every projection row — so 256 long notes is a far larger transient
 * allocation than 256 daily notes, and the peak lands on top of whatever the
 * rest of the app is holding. {@link INDEX_APPLY_BATCH_BYTES} is the real
 * bound; this count only keeps small-note graphs from making one enormous
 * transaction out of thousands of rows.
 */
export const INDEX_APPLY_BATCH_SIZE = 64

/**
 * Byte budget for one `index_apply_batch` transaction, measured with
 * {@link indexedNoteWeight}. A batch flushes as soon as the queued
 * projections exceed it, so a graph of large notes indexes in the same
 * bounded memory as a graph of small ones. A single note past the budget
 * still applies alone — this caps accumulation, not note size.
 */
export const INDEX_APPLY_BATCH_BYTES = 8 * 1024 * 1024

/**
 * Paths per transaction for the batches that carry no note content: removals
 * (a path list) and mtime re-stamps (a path plus two numbers). Those rows are
 * bounded by construction, so they keep the larger transaction size the
 * projection batches gave up.
 */
export const INDEX_PATH_BATCH_SIZE = 256

/** Fixed cost of a queued projection beyond its text: the scalar columns. */
const NOTE_OVERHEAD_BYTES = 512

/** Charged per projection row (link, tag, alias, claim, email, task, …). */
const PROJECTION_ROW_BYTES = 64

/**
 * Roughly how much memory a queued {@link IndexedNote} holds, in bytes.
 *
 * An estimate on purpose: it counts the fields that actually scale with a
 * note — its text, the folded asset and property text, the preview — and
 * charges a flat rate for each projection row, rather than serializing the
 * note to measure it (which would allocate the very payload the budget
 * exists to bound). String lengths are UTF-16 code units, so non-Latin text
 * is undercounted by up to a third; the budget is sized with that slack.
 */
export function indexedNoteWeight(note: IndexedNote): number {
  const text =
    note.text.length + note.assetText.length + note.preview.length + note.propertiesText.length
  const rows =
    note.links.length +
    note.tags.length +
    note.aliases.length +
    note.claims.length +
    note.emails.length +
    note.assets.length +
    note.tasks.length +
    note.properties.length
  return NOTE_OVERHEAD_BYTES + text + rows * PROJECTION_ROW_BYTES
}

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
 * `index_apply_batch` transactions bounded by {@link INDEX_APPLY_BATCH_SIZE}
 * *and* {@link INDEX_APPLY_BATCH_BYTES}, and degrade refused batches through
 * {@link applySplitBatch}'s halving retry so failures attribute to single
 * notes. Callers own *when* to flush early — e.g. before a remove that must
 * not be overtaken by queued upserts.
 */
export function createIndexApplyBatch(
  generation: number,
  onSkippedNote?: (note: SkippedIndexedNote) => void,
): IndexApplyBatch {
  let batch: IndexedNote[] = []
  let batchBytes = 0
  let appliedCount = 0
  async function flush(): Promise<void> {
    if (batch.length === 0) {
      return
    }
    const notes = batch
    batch = []
    batchBytes = 0
    appliedCount += await applySplitBatch(notes, generation, onSkippedNote)
  }
  return {
    add: async (note) => {
      batch.push(note)
      batchBytes += indexedNoteWeight(note)
      if (batch.length >= INDEX_APPLY_BATCH_SIZE || batchBytes >= INDEX_APPLY_BATCH_BYTES) {
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
 * {@link INDEX_PATH_BATCH_SIZE}. Both bulk skip paths (reconcile, watcher
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
      if (batch.length >= INDEX_PATH_BATCH_SIZE) {
        await flush()
      }
    },
    flush,
    applied: () => appliedCount,
  }
}
