import { renderHook } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getNote = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getNote,
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({ settings: { dateFormat: 'iso', timeFormat: '24h' } }),
}))
vi.mock('@/lib/use-today', () => ({ useToday: () => '2026-08-20' }))

const { useTemplateValues } = await import('./use-template-values')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useTemplateValues', () => {
  it('resolves the target title from the index and formats date and time', async () => {
    getNote.mockResolvedValueOnce({ title: 'Atomic Habits' })
    const { result } = await renderHook(() => useTemplateValues())
    const values = await result.current('notes/atomic-habits.md')
    expect(getNote).toHaveBeenCalledWith('notes/atomic-habits.md')
    expect(values.title).toBe('Atomic Habits')
    // The `iso` date format returns the ISO day itself.
    expect(values.date).toBe('2026-08-20')
    expect(values.dateIso).toBe('2026-08-20')
    expect(values.time).toMatch(/^\d{1,2}:\d{2}$/)
  })

  it('falls back to the file stem when the index has no row or fails', async () => {
    getNote.mockResolvedValueOnce(null)
    const { result } = await renderHook(() => useTemplateValues())
    await expect(result.current('notes/reading-list.md')).resolves.toMatchObject({
      title: 'reading-list',
    })

    getNote.mockRejectedValueOnce(new Error('index rebuilding'))
    await expect(result.current('notes/reading-list.md')).resolves.toMatchObject({
      title: 'reading-list',
    })
  })

  it('resolves an empty title without a target note', async () => {
    const { result } = await renderHook(() => useTemplateValues())
    await expect(result.current(null)).resolves.toMatchObject({ title: '' })
    expect(getNote).not.toHaveBeenCalled()
  })
})
