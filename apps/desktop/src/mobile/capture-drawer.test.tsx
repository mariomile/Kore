import type { ReactNode } from 'react'
import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileCaptureDrawer } from './capture-drawer'

/**
 * The capture hub's destinations. Capture flows into the daily note by
 * default (AGENTS.md — "Daily notes first"), so the hub has to keep offering
 * that destination alongside the standalone note; a hub that only starts
 * fresh notes silently drops every quick thought out of the daily stream.
 */

// The drawer needs browser APIs jsdom doesn't provide (matchMedia, pointer
// capture); its drag/animation is verified on-device. This passthrough
// honours `open` so open/close behavior stays testable.
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}))
// Sending taps a haptic; the test browser has no haptics plugin.
vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: vi.fn() }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/vault', generation: 7 } }),
}))
const drain = vi.hoisted(() => vi.fn())
vi.mock('@/providers/capture-provider', () => ({ requestCaptureDrain: drain }))
const spool = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  captureInboxSpool: spool,
}))

afterEach(() => {
  cleanup()
  spool.mockClear()
  drain.mockClear()
})

async function mount() {
  const handlers = {
    onOpenChange: vi.fn(),
    onDaily: vi.fn(),
    onNote: vi.fn(),
    onTask: vi.fn(),
    onRecord: vi.fn(),
  }
  await render(<MobileCaptureDrawer open recordingAvailable {...handlers} />)
  return handlers
}

describe('MobileCaptureDrawer', () => {
  it('opens the daily from an empty field and closes the hub', async () => {
    const { onDaily, onNote, onOpenChange } = await mount()

    await userEvent.click(page.getByRole('button', { name: 'Daily' }))
    expect(onDaily).toHaveBeenCalledOnce()
    expect(onNote).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps a separate destination for a standalone note', async () => {
    const { onDaily, onNote } = await mount()

    await userEvent.click(page.getByRole('button', { name: 'Note' }))
    expect(onNote).toHaveBeenCalledOnce()
    expect(onDaily).not.toHaveBeenCalled()
  })

  it('sends a typed line to today’s daily through the capture inbox and drains it', async () => {
    const { onDaily, onOpenChange } = await mount()

    await userEvent.fill(page.getByRole('textbox', { name: 'Capture' }), 'Idea widget')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))

    expect(spool).toHaveBeenCalledOnce()
    const [name, json, generation] = spool.mock.calls[0] as unknown as [string, string, number]
    expect(name).toMatch(/\.json$/)
    expect(JSON.parse(json)).toMatchObject({ kind: 'append', text: 'Idea widget' })
    expect(generation).toBe(7)
    expect(drain).toHaveBeenCalledOnce()
    expect(onDaily).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('files a typed line as a task once Task is picked', async () => {
    const { onTask } = await mount()

    await userEvent.fill(page.getByRole('textbox', { name: 'Capture' }), 'Call Anna')
    await userEvent.click(page.getByRole('button', { name: 'Task' }))
    await userEvent.click(page.getByRole('button', { name: 'Add' }))

    expect(onTask).not.toHaveBeenCalled()
    expect(JSON.parse((spool.mock.calls[0] as unknown as [string, string])[1])).toMatchObject({
      kind: 'task',
      text: 'Call Anna',
    })
  })
})
