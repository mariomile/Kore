/**
 * Event-loop pacing for the long index passes. A pass over thousands of
 * notes parses and hashes on the webview's only thread; without explicit
 * breaks the UI (and on iOS the whole app) reads as frozen even though the
 * per-file awaits technically yield.
 *
 * Breaks are due by **time**, not by file count: parsing costs roughly a
 * millisecond per 2 KB, so sixteen meeting transcripts in a row (they sit in
 * one folder, so the listing serves them back to back) held the thread for
 * over half a second per round while sixteen stubs cost almost nothing. A
 * pass now offers the thread back once {@link INDEX_PASS_WORK_BUDGET_MS} of
 * work has accumulated, which bounds a frame's wait at the budget plus one
 * file's parse.
 */

/** Files between progress reports, and the cap on files between breaks. */
export const INDEX_PASS_YIELD_EVERY = 16

/**
 * Work a pass may do before it must offer the thread back. Half a 60 Hz frame:
 * with the break itself costing well under a millisecond, input and rendering
 * get a slot every frame while the pass keeps over 90% of the thread.
 */
export const INDEX_PASS_WORK_BUDGET_MS = 8

/**
 * Complete after a macrotask turn, letting rendering and input run. Posted
 * through a `MessageChannel` where there is one: a zero-delay timer is
 * clamped to 4 ms once timers nest, which taxed a pass by a third at this
 * break rate (and to a full second in a backgrounded webview). The port is
 * closed after its one message so a headless host can exit.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0)
      return
    }
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/** Paces one index pass; see {@link createPassPacer}. */
export interface PassPacer {
  /**
   * Call once per file. Takes an event-loop break when one is due and
   * resolves `true`; otherwise resolves `false` without leaving the task.
   */
  pause: () => Promise<boolean>
}

/**
 * A pacer for one index pass: a break is due once
 * {@link INDEX_PASS_WORK_BUDGET_MS} has elapsed since the last one, or after
 * {@link INDEX_PASS_YIELD_EVERY} files regardless (a clock that does not
 * advance must not turn the pass into one long task). Elapsed time counts
 * the pass's own awaits too; that only ever makes a break come early.
 */
export function createPassPacer(): PassPacer {
  let files = 0
  let resumedAt = performance.now()
  return {
    async pause(): Promise<boolean> {
      files += 1
      if (
        files < INDEX_PASS_YIELD_EVERY &&
        performance.now() - resumedAt < INDEX_PASS_WORK_BUDGET_MS
      ) {
        return false
      }
      await yieldToEventLoop()
      files = 0
      resumedAt = performance.now()
      return true
    },
  }
}
