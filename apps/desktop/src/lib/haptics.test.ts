import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `haptic` maps one interaction vocabulary onto each platform's hardware:
 * every kind plays on the iPhone (through the keyboard plugin's `haptic`
 * command), only gestures knock the Mac trackpad. It must obey the
 * `hapticFeedback` setting, and fail soft on iOS where the plugin isn't
 * registered: one warning, then no further IPC.
 */

const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>()
const platform = vi.hoisted(() => ({ mac: false }))

vi.mock('@/lib/platform', () => ({
  get isMacosDesktop() {
    return platform.mac
  },
}))

type Haptics = typeof import('./haptics')

async function load(surface: 'ios' | 'mac' | 'browser'): Promise<Haptics> {
  // resetModules gives this test a fresh latch and a fresh @kore/core;
  // install the fake bridge on the same instance the module under test sees.
  platform.mac = surface === 'mac'
  const core = await import('@kore/core')
  core.setBridge({
    invoke: (command, args) => invokeMock(command, args),
    listen: async () => () => {},
  })
  const { setPlatformSurface } = await import('@/lib/platform-surface')
  setPlatformSurface({ mobileApp: surface === 'ios' })
  return await import('./haptics')
}

beforeEach(() => {
  vi.resetModules()
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(null)
})

describe('haptic on the iPhone', () => {
  it('plays the native style each kind maps to', async () => {
    const { haptic } = await load('ios')

    haptic('selection')
    haptic('lift')
    haptic('toggle')
    haptic('warning')

    expect(invokeMock.mock.calls).toEqual([
      ['plugin:keyboard|haptic', { request: { style: 'selection' } }],
      ['plugin:keyboard|haptic', { request: { style: 'medium' } }],
      ['plugin:keyboard|haptic', { request: { style: 'light' } }],
      ['plugin:keyboard|haptic', { request: { style: 'warning' } }],
    ])
  })

  it('stays silent while the haptics setting is off', async () => {
    // Same module registry as the import inside `load` (both follow this
    // `resetModules`), so the latch the test writes is the one the module
    // under test reads.
    const { setHapticsEnabled } = await import('@/lib/haptics-preference')
    const { haptic } = await load('ios')

    setHapticsEnabled(false)
    haptic('action')
    expect(invokeMock).not.toHaveBeenCalled()

    setHapticsEnabled(true)
    haptic('action')
    expect(invokeMock).toHaveBeenCalledOnce()
  })

  it('warns once and stops invoking after the bridge rejects', async () => {
    invokeMock.mockRejectedValue(new Error('plugin keyboard not found'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { haptic } = await load('ios')

    // Two taps with both invokes in flight: only the first rejection warns.
    haptic('selection')
    haptic('selection')
    expect(invokeMock).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce())

    haptic('selection')
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('haptic on the Mac', () => {
  it('knocks the trackpad only for gestures, never for clicks or outcomes', async () => {
    const { haptic } = await load('mac')

    haptic('selection')
    haptic('action')
    haptic('lift')
    haptic('success')
    haptic('warning')
    haptic('toggle')
    expect(invokeMock).not.toHaveBeenCalled()

    haptic('snap')
    haptic('drop')
    haptic('error')
    expect(invokeMock.mock.calls).toEqual([
      ['haptic_feedback', { pattern: 'alignment' }],
      ['haptic_feedback', { pattern: 'alignment' }],
      ['haptic_feedback', { pattern: 'generic' }],
    ])
  })
})

describe('haptic in a plain browser', () => {
  it('fires nothing', async () => {
    const { haptic } = await load('browser')

    haptic('snap')
    haptic('selection')
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
