import type { ReactNode } from 'react'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AllNotesSort } from '@kore/core'
import { AllNotesSortDrawer, allNotesSortSummary } from './all-notes-sort-drawer'

/**
 * The Notes tab's sort sheet: a field list plus a direction segmented row,
 * both writing the one persisted `allNotesSort` the Mac list reads.
 */

// The drawer needs browser APIs the test page doesn't fake (pointer capture,
// the drag spring); its motion is verified on-device. This passthrough
// honours `open` so the content stays testable.
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: vi.fn() }))

afterEach(cleanup)

async function mount(sort: AllNotesSort) {
  const onSortChange = vi.fn()
  await render(
    <AllNotesSortDrawer open onOpenChange={() => {}} sort={sort} onSortChange={onSortChange} />,
  )
  return onSortChange
}

describe('AllNotesSortDrawer', () => {
  it('marks the current field and offers its own direction pair', async () => {
    await mount('updated-desc')
    await expect
      .element(page.getByRole('button', { name: 'Last updated' }))
      .toHaveAttribute('aria-current', 'true')
    await expect
      .element(page.getByRole('radio', { name: 'Newest first' }))
      .toHaveAttribute('aria-checked', 'true')
    await expect.element(page.getByRole('radio', { name: 'Oldest first' })).toBeVisible()
  })

  it('switching field resets to that field’s natural direction', async () => {
    const onSortChange = await mount('updated-asc')
    await page.getByRole('button', { name: 'Title' }).click()
    expect(onSortChange).toHaveBeenCalledWith('title-asc')
  })

  it('re-picking the current field keeps its direction', async () => {
    const onSortChange = await mount('title-desc')
    await page.getByRole('button', { name: 'Title' }).click()
    expect(onSortChange).not.toHaveBeenCalled()
  })

  it('flips the direction within the current field', async () => {
    const onSortChange = await mount('title-asc')
    await page.getByRole('radio', { name: 'Z to A' }).click()
    expect(onSortChange).toHaveBeenCalledWith('title-desc')
  })
})

describe('allNotesSortSummary', () => {
  it('names the field and direction for the trigger', () => {
    expect(allNotesSortSummary('updated-desc')).toBe('Last updated, Newest first')
    expect(allNotesSortSummary('title-desc')).toBe('Title, Z to A')
  })
})
