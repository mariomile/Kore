import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { resetOperations, startOperation, useOperations } from './operations'
import { act } from '@/test-utils/act'

beforeEach(() => {
  vi.useFakeTimers()
  resetOperations()
})
afterEach(() => {
  vi.useRealTimers()
  resetOperations()
})

describe('operations store', () => {
  it('tracks start → progress → done through the hook', async () => {
    const { result } = await renderHook(() => useOperations())
    expect(result.current).toEqual([])

    let handle!: ReturnType<typeof startOperation>
    await act(() => {
      handle = startOperation('Renaming "A" → "B"')
    })
    expect(result.current).toHaveLength(1)
    expect(result.current[0]!.label).toBe('Renaming "A" → "B"')
    expect(result.current[0]!.progress).toBeNull()

    await act(() => handle.progress(3, 12))
    expect(result.current[0]!.progress).toEqual({ done: 3, total: 12 })

    await act(() => handle.done())
    // Once shown, the entry stays for the minimum visible window — a fast
    // operation must not flash for a single frame.
    expect(result.current).toHaveLength(1)
    await act(() => vi.advanceTimersByTime(1200))
    expect(result.current).toEqual([])
  })

  it('a failed operation lingers with its error, then clears', async () => {
    const { result } = await renderHook(() => useOperations())
    let handle!: ReturnType<typeof startOperation>
    await act(() => {
      handle = startOperation('Renaming "A" → "B"')
    })
    await act(() => handle.fail('disk full'))
    expect(result.current[0]!.status).toBe('failed')
    expect(result.current[0]!.message).toBe('disk full')

    await act(() => vi.advanceTimersByTime(8000 + 1200))
    expect(result.current).toEqual([])
  })

  it('a warning operation lingers without being marked failed', async () => {
    const { result } = await renderHook(() => useOperations())
    let handle!: ReturnType<typeof startOperation>
    await act(() => {
      handle = startOperation('Rebuilding search index')
    })
    await act(() => handle.warn('Rebuilt with 1 skipped note: notes/bad.md'))
    expect(result.current[0]!.status).toBe('warning')
    expect(result.current[0]!.message).toBe('Rebuilt with 1 skipped note: notes/bad.md')

    await act(() => vi.advanceTimersByTime(8000 + 1200))
    expect(result.current).toEqual([])
  })

  it('handles are scoped: finishing one operation leaves others running', async () => {
    const { result } = await renderHook(() => useOperations())
    let first!: ReturnType<typeof startOperation>
    await act(() => {
      first = startOperation('first')
      startOperation('second')
    })
    await act(() => first.done())
    await act(() => vi.advanceTimersByTime(1200))
    expect(result.current.map((operation) => operation.label)).toEqual(['second'])
  })

  it('stores optional toast metadata and can dismiss immediately', async () => {
    const { result } = await renderHook(() => useOperations())
    const run = vi.fn()
    let handle!: ReturnType<typeof startOperation>

    await act(() => {
      handle = startOperation('Install update', {
        description: 'Kore 1.2.3 is ready.',
        persistent: true,
        action: { label: 'Install', run },
      })
    })

    expect(result.current[0]).toMatchObject({
      label: 'Install update',
      description: 'Kore 1.2.3 is ready.',
      persistent: true,
      action: { label: 'Install', run },
    })

    await act(() => vi.advanceTimersByTime(30_000))
    expect(result.current).toHaveLength(1)

    await act(() => handle.dismiss())
    expect(result.current).toEqual([])
  })

  it('keeps persistent failures visible until dismissed', async () => {
    const { result } = await renderHook(() => useOperations())
    let handle!: ReturnType<typeof startOperation>

    await act(() => {
      handle = startOperation('Install update', { persistent: true })
    })
    await act(() => handle.fail('signature failed'))
    await act(() => vi.advanceTimersByTime(30_000))

    expect(result.current[0]).toMatchObject({
      label: 'Install update',
      status: 'failed',
      message: 'signature failed',
    })

    await act(() => handle.dismiss())
    expect(result.current).toEqual([])
  })
})
