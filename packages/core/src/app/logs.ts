import { z } from 'zod'
import { call } from '../ipc/invoke'

/** Severity of a webview message recorded in the local log. */
export type WebviewLogLevel = 'warn' | 'error'

/**
 * Record one webview message in the app's local log file (see
 * `apps/desktop/src-tauri/src/logs.rs`). The file stays on the machine; it is
 * what a user attaches to a bug report.
 */
export function logWebview(level: WebviewLogLevel, message: string): Promise<void> {
  return call('log_webview', { level, message }, z.null()).then(() => undefined)
}

/** Open the folder holding the local log files in the OS file manager. */
export function revealLogs(): Promise<void> {
  return call('logs_reveal', {}, z.null()).then(() => undefined)
}
