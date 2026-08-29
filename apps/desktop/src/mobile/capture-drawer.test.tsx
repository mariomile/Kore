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

afterEach(cleanup)

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
  it('sends a capture to the daily note and closes the hub', async () => {
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
})
