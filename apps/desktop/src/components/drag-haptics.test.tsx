import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { haptic } from '@/lib/haptics'
import { DragHaptics } from './drag-haptics'

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

interface Monitor {
  onDragStart: (event: Pick<DragStartEvent, 'active'>) => void
  onDragOver: (event: Pick<DragOverEvent, 'over'>) => void
  onDragEnd: (event: Pick<DragEndEvent, 'active' | 'over'>) => void
  onDragCancel: () => void
}

const monitor = vi.hoisted(() => ({ current: null as Monitor | null }))

vi.mock('@dnd-kit/core', () => ({
  useDndMonitor: (handlers: Monitor) => {
    monitor.current = handlers
  },
}))

const item = (id: string) => ({ id }) as never

async function mounted(): Promise<Monitor> {
  await render(<DragHaptics />)
  if (monitor.current === null) throw new Error('DragHaptics did not subscribe')
  return monitor.current
}

beforeEach(() => {
  vi.mocked(haptic).mockClear()
  monitor.current = null
})

describe('DragHaptics', () => {
  it('lifts, snaps over each new place, and drops where it lands', async () => {
    const events = await mounted()

    events.onDragStart({ active: item('a') })
    events.onDragOver({ over: item('a') }) // still over its own slot
    events.onDragOver({ over: item('b') })
    events.onDragOver({ over: null })
    events.onDragOver({ over: item('c') })
    events.onDragEnd({ active: item('a'), over: item('c') })

    expect(vi.mocked(haptic).mock.calls).toEqual([['lift'], ['snap'], ['snap'], ['drop']])
  })

  it('does not drop when the item lands back on itself or nowhere', async () => {
    const events = await mounted()

    events.onDragStart({ active: item('a') })
    events.onDragEnd({ active: item('a'), over: item('a') })
    events.onDragStart({ active: item('a') })
    events.onDragEnd({ active: item('a'), over: null })

    expect(vi.mocked(haptic).mock.calls).toEqual([['lift'], ['lift']])
  })
})
