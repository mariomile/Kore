import type { ReactNode } from 'react'
import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionValue, TagProperty } from '@kore/core'
import { MobileCellEditorDrawer } from './mobile-cell-editor-drawer'

/**
 * The iPhone property sheet's date editor: Kore's own month grid, never a
 * native date input (iOS opened its calendar popover over the sheet, so the
 * user saw two calendars). A tap saves the day and closes; a time is kept.
 */

// The drawer needs browser APIs the test page lacks (pointer capture, drag);
// its animation is verified on-device. This passthrough honours `open`.
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/use-today', () => ({ useToday: () => '2026-11-26' }))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { weekStartDay: 'monday', dateFormat: 'iso' },
    updateSettings: () => {},
  }),
}))

afterEach(cleanup)

const due: TagProperty = { name: 'Due', key: 'due', type: 'date' }

function dateValue(value: string): CollectionValue {
  return { value, valueType: 'string', valueNumber: null }
}

async function mount(value: CollectionValue | undefined, property: TagProperty = due) {
  const onCommit = vi.fn()
  const onClose = vi.fn()
  await render(
    <MobileCellEditorDrawer
      target={{ entryPath: 'notes/prep.md', entryTitle: 'Prep', property, value }}
      onClose={onClose}
      onCommit={onCommit}
      onOpenRelation={() => {}}
    />,
  )
  return { onCommit, onClose }
}

describe('MobileCellEditorDrawer date property', () => {
  it('shows Kore’s month grid on the stored date, with no native date input', async () => {
    await mount(dateValue('2026-11-12'))

    await expect
      .element(page.getByRole('button', { name: '2026-11-12' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(page.getByRole('button', { name: '2026-11-26' }))
      .toHaveAttribute('aria-current', 'date')
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('saves the tapped day and closes the sheet', async () => {
    const { onCommit, onClose } = await mount(undefined)

    await userEvent.click(page.getByRole('button', { name: '2026-11-20' }))
    expect(onCommit).toHaveBeenCalledWith('notes/prep.md', 'due', '2026-11-20')
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps a stored time when the day changes', async () => {
    const { onCommit } = await mount(dateValue('2026-11-12T09:30'))

    await userEvent.click(page.getByRole('button', { name: '2026-11-13' }))
    expect(onCommit).toHaveBeenCalledWith('notes/prep.md', 'due', '2026-11-13T09:30')
  })

  it('closes without writing when the stored day is tapped again', async () => {
    const { onCommit, onClose } = await mount(dateValue('2026-11-12'))

    await userEvent.click(page.getByRole('button', { name: '2026-11-12' }))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('clears the date', async () => {
    const { onCommit, onClose } = await mount(dateValue('2026-11-12'))

    await userEvent.click(page.getByRole('button', { name: 'Clear date' }))
    expect(onCommit).toHaveBeenCalledWith('notes/prep.md', 'due', undefined)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MobileCellEditorDrawer text property', () => {
  const tldr: TagProperty = { name: 'tldr', key: 'tldr', type: 'text' }
  const long =
    'Venerdì 27 nov, 14:30-15:30 ora di Roma, Google Meet. Walkthrough di 40-60 minuti, ' +
    'senza slide. Storia principale e seconda storia, poi il ponte con il team.'

  it('edits long text in a field that grows to show all of it', async () => {
    const { onCommit, onClose } = await mount(dateValue(long), tldr)

    const field = page.getByRole('textbox', { name: 'tldr' })
    await expect.element(field).toHaveValue(long)
    const element = field.element() as HTMLTextAreaElement
    expect(element.tagName).toBe('TEXTAREA')
    expect(element.scrollHeight).toBeLessThanOrEqual(element.clientHeight + 1)

    await field.fill('Short\nnote')
    await userEvent.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledWith('notes/prep.md', 'tldr', 'Short note')
    expect(onClose).toHaveBeenCalled()
  })
})
