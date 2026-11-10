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

/** How long a run waits before {@link AgentRunLockOptions.onWaiting} fires. */
export const AGENT_RUN_WAIT_NOTICE_MS = 300

export interface AgentRunLockOptions {
  /**
   * Gives up the wait for the lock. An abort while queued rejects at once
   * with the signal's reason and `work` never runs; the queue behind keeps
   * moving. Once `work` has started, cancelling it is `work`'s job.
   */
  signal?: AbortSignal
  /**
   * Called once when the lock is still held by another run after
   * {@link AGENT_RUN_WAIT_NOTICE_MS}, so the caller can say it is waiting.
   * The returned cleanup runs when the wait ends, granted or aborted.
   */
  onWaiting?: () => () => void
}

/** Run `work` once every previously queued run has finished. */
export async function withAgentRunLock<T>(
  work: () => Promise<T>,
  options: AgentRunLockOptions = {},
): Promise<T> {
  const { signal, onWaiting } = options
  signal?.throwIfAborted()
  const previous = tail
  let release: () => void = () => {}
  tail = new Promise((resolve) => {
    release = resolve
  })
  // Who frees this run's slot in the local queue: normally the `finally`
  // below; after an abort mid-wait, the background step that waits out
  // whatever was still pending, so the next run never starts early.
  let releaseHandedOff = false
  const waitNotice = startWaitNotice(onWaiting)
  try {
    try {
      await abortable(previous, signal)
    } catch (cause) {
      releaseHandedOff = true
      void previous.then(release)
      throw cause
    }
    let lease: number | null = null
    if (hasBridge()) {
      const acquiring = acquireAgentRunLease()
      try {
        lease = await abortable(acquiring, signal)
      } catch (cause) {
        if (signal?.aborted === true) {
          // The native wait cannot be withdrawn: the lease is granted later
          // all the same. Hand it straight back when it arrives, or it
          // would wedge every window's agent runs.
          releaseHandedOff = true
          void acquiring
            .then((granted) => releaseAgentRunLease(granted))
            .catch(() => {})
            .finally(release)
        }
        throw cause
      }
    }
    waitNotice.end()
    try {
      signal?.throwIfAborted()
      return await work()
    } finally {
      if (lease !== null) {
        await releaseAgentRunLease(lease)
      }
    }
  } finally {
    waitNotice.end()
    if (!releaseHandedOff) {
      release()
    }
  }
}

function startWaitNotice(onWaiting: AgentRunLockOptions['onWaiting']): {
  end: () => void
} {
  if (onWaiting === undefined) {
    return { end: () => {} }
  }
  let cleanup: (() => void) | undefined
  let ended = false
  const timer = setTimeout(() => {
    if (!ended) {
      cleanup = onWaiting()
    }
  }, AGENT_RUN_WAIT_NOTICE_MS)
  return {
    end: () => {
      if (ended) {
        return
      }
      ended = true
      clearTimeout(timer)
      cleanup?.()
    },
  }
}

/** `promise`, or a rejection with the signal's reason as soon as it aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      )
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(cause)
      },
    )
  })
}
