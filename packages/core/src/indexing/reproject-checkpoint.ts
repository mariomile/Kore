import { z } from 'zod'
import { setIndexMeta } from './commands'
import { projectionStamp } from './indexed-note'
import { getIndexMeta } from './queries'

/**
 * The `index_meta` key recording how far an unfinished full re-derivation
 * got: `{ stamp, after }`, where every listed note sorting at or before
 * `after` already carries the projection `stamp` names. Without it, a pass
 * that iOS suspends (the app goes to the background, or is killed) starts
 * over from the first note on the next open, so on a vault of a few thousand
 * notes the iPhone re-read the whole vault on every launch and could never
 * finish. Cleared ('') when the pass completes or a manual rebuild starts.
 */
export const REPROJECT_CHECKPOINT_KEY = 'reproject_checkpoint'

/** Listed notes re-derived between two checkpoint writes. */
export const REPROJECT_CHECKPOINT_EVERY = 256

const checkpointSchema = z.object({ stamp: z.string(), after: z.string() })

export type ReprojectCheckpoint = z.infer<typeof checkpointSchema>

/**
 * The stored checkpoint, only when it was written for the current
 * {@link projectionStamp}: progress toward an older projection describes
 * rows that are stale again.
 */
export async function readReprojectCheckpoint(): Promise<ReprojectCheckpoint | null> {
  const raw = await getIndexMeta(REPROJECT_CHECKPOINT_KEY)
  if (raw === null || raw === '') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null // unreadable: start over, exactly as before checkpoints existed
  }
  const checkpoint = checkpointSchema.safeParse(parsed)
  return checkpoint.success && checkpoint.data.stamp === projectionStamp() ? checkpoint.data : null
}

/** Record that every listed note up to `after` carries `stamp`. */
export async function writeReprojectCheckpoint(
  checkpoint: ReprojectCheckpoint,
  generation: number,
): Promise<void> {
  await setIndexMeta(REPROJECT_CHECKPOINT_KEY, JSON.stringify(checkpoint), generation)
}

/** Forget any stored progress (the pass finished, or a wipe starts over). */
export async function clearReprojectCheckpoint(generation: number): Promise<void> {
  await setIndexMeta(REPROJECT_CHECKPOINT_KEY, '', generation)
}
