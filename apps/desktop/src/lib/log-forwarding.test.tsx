import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logWebview = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  logWebview,
}))
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isNativeShell: () => true,
}))

import { installLogForwarding } from './log-forwarding'

describe('installLogForwarding', () => {
  const realWarn = console.warn
  const realError = console.error
  const consoleWarn = vi.fn()
  const consoleError = vi.fn()

  beforeEach(() => {
    // Stand-ins, so the forwarder wraps spies instead of the fail-on-console hooks.
    console.warn = consoleWarn
    console.error = consoleError
    consoleWarn.mockClear()
    consoleError.mockClear()
    logWebview.mockClear()
    installLogForwarding()
  })

  afterEach(() => {
    console.warn = realWarn
    console.error = realError
  })

  it('keeps the console output and records errors with their stack', async () => {
    const failure = new Error('disk on fire')
    console.error('failed to save note:', failure)
    console.warn('index', { stale: true })

    expect(consoleError).toHaveBeenCalledWith('failed to save note:', failure)
    expect(consoleWarn).toHaveBeenCalledWith('index', { stale: true })
    expect(logWebview).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/^failed to save note: Error: disk on fire\n.*log-forwarding\.test/s),
    )
    expect(logWebview).toHaveBeenCalledWith('warn', 'index {"stale":true}')
  })

  it('records unhandled rejections with the error message', async () => {
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('lost write'),
      }),
    )
    expect(logWebview).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/^unhandled rejection: Error: lost write\n/),
    )
  })

  it('never logs a forward that fails, which would loop', async () => {
    logWebview.mockRejectedValueOnce(new Error('bridge gone'))
    console.error('boom')
    await vi.waitFor(() => expect(logWebview).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(logWebview).toHaveBeenCalledTimes(1)
  })
})
