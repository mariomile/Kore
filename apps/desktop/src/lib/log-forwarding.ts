import { logWebview, type WebviewLogLevel } from '@reflect/core'
import { isNativeShell } from '@/lib/platform'

/**
 * One console argument as log text. Errors keep name, message and stack:
 * WebKit's `stack` omits the message that V8's starts with.
 */
function describeLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`
    if (value.stack === undefined || value.stack === '') {
      return head
    }
    return value.stack.startsWith(head) ? value.stack : `${head}\n${value.stack}`
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function record(level: WebviewLogLevel, message: string): void {
  // Never log a failed forward: it would loop back through console.error.
  logWebview(level, message).catch(() => {})
}

/**
 * Copy this window's `console.warn` / `console.error` calls, uncaught errors
 * and unhandled rejections into the app's local log file, so a user can
 * attach what went wrong to a bug report. The console output itself is
 * unchanged. Native shell only: plain-browser dev keeps its own DevTools.
 */
export function installLogForwarding(): void {
  if (!isNativeShell()) {
    return
  }
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      record(level, args.map(describeLogValue).join(' '))
    }
  }
  window.addEventListener('error', (event) => {
    record('error', `uncaught: ${describeLogValue(event.error ?? event.message)}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    record('error', `unhandled rejection: ${describeLogValue(event.reason)}`)
  })
}
