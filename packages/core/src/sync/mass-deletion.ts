/**
 * The mass-deletion guard (Plan 12 sync policy): a merge or push that would
 * delete much of the vault pauses for the user's yes instead of running. An
 * agent once pushed a commit holding only the two files it touched; merged
 * and pushed back unchecked, it deleted 10,359 notes on every device.
 */
import type { SyncDeletions } from './commands'

/**
 * A merge or push that would delete at least this many files, or at least a
 * quarter of the vault (and no fewer than {@link MASS_DELETION_MIN_FILES}),
 * waits for the user's yes.
 */
const MASS_DELETION_FILES = 100
const MASS_DELETION_MIN_FILES = 20
const MASS_DELETION_SHARE = 0.25

/** A merge (`incoming`) or push (`outgoing`) paused before a mass deletion. */
export class MassDeletionError extends Error {
  constructor(direction: 'incoming' | 'outgoing', deleted: number, tracked: number) {
    const share = `${deleted.toLocaleString('en-US')} of ${tracked.toLocaleString('en-US')} files`
    super(
      direction === 'incoming'
        ? `Sync paused: changes from another device would delete ${share} here. Nothing has been deleted.`
        : `Sync paused: this device would delete ${share} on your other devices. Nothing has been uploaded.`,
    )
  }
}

/**
 * Whether deleting `deleted` of `tracked` files needs the user's yes. Shared
 * by git sync and Kore Cloud, which applies it on the server to every writer.
 */
export function isMassDeletion(deleted: number, tracked: number): boolean {
  return (
    deleted >= MASS_DELETION_FILES ||
    (deleted >= MASS_DELETION_MIN_FILES && deleted >= tracked * MASS_DELETION_SHARE)
  )
}

/** Throw {@link MassDeletionError} when `direction`'s deletions need the user's yes. */
export function assertNoMassDeletion(
  direction: 'incoming' | 'outgoing',
  counts: SyncDeletions,
): void {
  const deleted = counts[direction]
  if (isMassDeletion(deleted, counts.tracked)) {
    throw new MassDeletionError(direction, deleted, counts.tracked)
  }
}
