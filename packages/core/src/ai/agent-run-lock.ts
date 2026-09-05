import { hasBridge } from '../ipc/bridge'
import { acquireAgentRunLease, releaseAgentRunLease } from './agent-runtime'

/**
 * One agent acts on the vault at a time. Every edit-mode run (a chat turn,
 * a scheduled routine) snapshots the graph, works, then diffs against its
 * snapshot to build the activity ledger — two overlapping runs would
 * cross-attribute each other's changes. This FIFO lock serializes them;
 * read-only chat never takes it.
 *
 * Two layers, composed: the module-level tail serializes runs within this
 * JS context, and the native lease (TDR 0007) serializes across every
 * window of the process — a chat turn in a note window and a routine in the
 * main window queue behind one another. Only hosts without a bridge use
 * the local layer alone; a failed native lease must prevent execution.
 */

let tail: Promise<void> = Promise.resolve()

/** Run `work` once every previously queued run has finished. */
export async function withAgentRunLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = tail
  let release: () => void = () => {}
  tail = new Promise((resolve) => {
    release = resolve
  })
  await previous
  try {
    const lease = hasBridge() ? await acquireAgentRunLease() : null
    try {
      return await work()
    } finally {
      if (lease !== null) {
        await releaseAgentRunLease(lease)
      }
    }
  } finally {
    release()
  }
}
