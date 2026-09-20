import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { GraphMapCanvas, type CanvasNode } from './graph-map-canvas'

// Observe the real scheduler without replacing frames, layout, or canvas.
const observed = vi.hoisted(() => ({ frames: 0, settled: false }))
vi.mock('@/lib/graph-frame-scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/graph-frame-scheduler')>()
  return {
    createGraphFrameScheduler: (renderFrame: () => boolean) =>
      actual.createGraphFrameScheduler(() => {
        observed.frames += 1
        const moving = renderFrame()
        observed.settled = !moving
        return moving
      }),
  }
})

const NODES: CanvasNode[] = [
  { id: 'notes/a.md', label: 'Alpha', inbound: 0, isDaily: false, color: null },
]
const EDGES: [] = []
let originalStyle: string | null

beforeEach(() => {
  observed.frames = 0
  observed.settled = false
  originalStyle = document.documentElement.getAttribute('style')
})

afterEach(() => {
  if (originalStyle === null) document.documentElement.removeAttribute('style')
  else document.documentElement.setAttribute('style', originalStyle)
})

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

it('repaints a settled graph for theme and search changes without losing note navigation', async () => {
  const onOpen = vi.fn()
  const surface = (matches: ReadonlySet<string> | null) => (
    <div style={{ width: 640, height: 480 }}>
      <GraphMapCanvas nodes={NODES} edges={EDGES} matches={matches} onOpen={onOpen} />
    </div>
  )
  const view = await render(surface(null))
  try {
    await vi.waitFor(() => expect(observed.settled).toBe(true), { timeout: 8000 })
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Note graph"]')!
    const before = canvas.toDataURL()

    document.documentElement.style.setProperty('--text-secondary', '#ff0000')
    await vi.waitFor(() => expect(canvas.toDataURL()).not.toBe(before))
    const themed = canvas.toDataURL()

    await view.rerender(surface(new Set(['notes/a.md'])))
    await vi.waitFor(() => expect(canvas.toDataURL()).not.toBe(themed))
    await view.getByRole('img', { name: 'Note graph' }).click()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('notes/a.md')
  } finally {
    await view.unmount()
  }
})

it('lets an empty graph sleep and stops observing themes after unmount', async () => {
  const view = await render(
    <div style={{ width: 640, height: 480 }}>
      <GraphMapCanvas nodes={[]} edges={EDGES} onOpen={() => {}} />
    </div>,
  )
  try {
    await vi.waitFor(() => expect(observed.frames).toBeGreaterThan(0))
    // Allow the initial ResizeObserver delivery before checking the idle state.
    await nextFrame()
    await nextFrame()
    const idleFrames = observed.frames
    await nextFrame()
    await nextFrame()
    expect(observed.frames).toBe(idleFrames)
  } finally {
    await view.unmount()
  }
  const disposedFrames = observed.frames
  document.documentElement.style.setProperty('--text-secondary', '#00ff00')
  await nextFrame()
  await nextFrame()
  expect(observed.frames).toBe(disposedFrames)
})
