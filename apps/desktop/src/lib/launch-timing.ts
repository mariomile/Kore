import { logWebview } from '@kore/core'
import { isNativeShell } from '@/lib/platform'
import { isMainWindow } from '@/lib/windows/window-role'

/** The launch milestones the main window records, in the order they happen. */
export type LaunchMark = 'script' | 'vault' | 'editor'

const marks = new Map<LaunchMark, number>()
let reported = false

/**
 * Record a launch milestone, in milliseconds since this webview started
 * loading (`performance.now()`). Only the first of each counts, and the line
 * goes to the local log once the first note editor has mounted, so launch
 * speed can be measured on a real Mac without a profiler. The native side
 * logs process start → page loaded under the same `launch` wording.
 */
export function markLaunch(mark: LaunchMark): void {
  if (reported || marks.has(mark)) {
    return
  }
  marks.set(mark, Math.round(performance.now()))
  if (mark === 'editor') {
    reported = true
    report()
  }
}

function formatLaunchLine(recorded: ReadonlyMap<LaunchMark, number>): string {
  const labels: Record<LaunchMark, string> = {
    script: 'app script ran',
    vault: 'vault ready',
    editor: 'first note editor',
  }
  const parts = [...recorded].map(([mark, ms]) => `${labels[mark]} ${ms} ms`)
  return `launch: ${parts.join(', ')} (since the window started loading)`
}

function report(): void {
  if (!isNativeShell() || !isMainWindow()) {
    return
  }
  logWebview('info', formatLaunchLine(marks)).catch(() => {})
}
