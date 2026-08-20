/**
 * One agent acts on the vault at a time. Every edit-mode run (a chat turn,
 * a scheduled routine) snapshots the graph, works, then diffs against its
 * snapshot to build the activity ledger — two overlapping runs would
 * cross-attribute each other's changes. This tiny FIFO lock serializes
 * them; read-only chat never takes it.
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
    return await work()
  } finally {
    release()
  }
}
