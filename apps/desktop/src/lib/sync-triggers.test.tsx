import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOREGROUND_PULL_MS, installSyncTriggers } from './sync-triggers'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('installSyncTriggers', () => {
  it('pulls on a timer while the app is in the foreground, until disposed', async () => {
    const syncNow = vi.fn(async () => {})
    const dispose = installSyncTriggers(syncNow)

    await vi.advanceTimersByTimeAsync(FOREGROUND_PULL_MS - 1)
    expect(syncNow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(syncNow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FOREGROUND_PULL_MS)
    expect(syncNow).toHaveBeenCalledTimes(2)

    dispose()
    await vi.advanceTimersByTimeAsync(FOREGROUND_PULL_MS * 3)
    expect(syncNow).toHaveBeenCalledTimes(2)
  })

  it('never polls while hidden or offline', async () => {
    const syncNow = vi.fn(async () => {})
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const dispose = installSyncTriggers(syncNow)

    await vi.advanceTimersByTimeAsync(FOREGROUND_PULL_MS)
    expect(syncNow).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(FOREGROUND_PULL_MS)
    expect(syncNow).not.toHaveBeenCalled()
    dispose()
  })
})
