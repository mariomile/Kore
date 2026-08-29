import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

/**
 * Quick add on the daily spine: one tap to the field, and the line goes out
 * through the capture inbox rather than through a second copy of the
 * daily-note append rules.
 */

const captureInboxSpool = vi.hoisted(() =>
  vi.fn<(name: string, body: string, generation: number) => Promise<void>>(),
)
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  captureInboxSpool,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/graphs/test', name: 'test', generation: 7 } }),
}))

import { textCaptureEnvelopeSchema } from '@reflect/core'

const { MobileQuickAdd } = await import('./quick-add-bar')

function spooled(): Record<string, unknown> {
  const body = captureInboxSpool.mock.calls.at(-1)?.[1] ?? '{}'
  return textCaptureEnvelopeSchema.parse(JSON.parse(body))
}

beforeEach(() => {
  captureInboxSpool.mockReset().mockResolvedValue()
})

describe('MobileQuickAdd', () => {
  it('opens the field from the collapsed button', async () => {
    const view = await render(<MobileQuickAdd />)

    await userEvent.click(view.getByRole('button', { name: 'Quick add', exact: true }))

    await expect.element(view.getByLabelText('Quick add to today')).toBeVisible()
  })

  it('spools a bullet for today and clears the field for the next line', async () => {
    const view = await render(<MobileQuickAdd />)
    await userEvent.click(view.getByRole('button', { name: 'Quick add', exact: true }))

    const field = view.getByLabelText('Quick add to today')
    await userEvent.fill(field, 'call the plumber')
    await userEvent.click(view.getByRole('button', { name: 'Add', exact: true }))

    expect(captureInboxSpool).toHaveBeenCalledTimes(1)
    expect(captureInboxSpool.mock.calls[0]?.[2]).toBe(7)
    expect(spooled()).toMatchObject({
      kind: 'append',
      text: 'call the plumber',
      source: 'quick-add',
    })
    await expect.element(field).toHaveValue('')
  })

  it('spools a real task when the row is toggled', async () => {
    const view = await render(<MobileQuickAdd />)
    await userEvent.click(view.getByRole('button', { name: 'Quick add', exact: true }))
    await userEvent.click(view.getByRole('button', { name: 'Add as a task' }))
    await userEvent.fill(view.getByLabelText('Quick add to today'), 'file the taxes')
    await userEvent.click(view.getByRole('button', { name: 'Add', exact: true }))

    expect(spooled()).toMatchObject({ kind: 'task', text: 'file the taxes' })
  })

  it('folds a pasted multi-line payload into one line', async () => {
    const view = await render(<MobileQuickAdd />)
    await userEvent.click(view.getByRole('button', { name: 'Quick add', exact: true }))
    await userEvent.fill(view.getByLabelText('Quick add to today'), 'one\ntwo')
    await userEvent.click(view.getByRole('button', { name: 'Add', exact: true }))

    expect(spooled().text).toBe('one two')
  })

  it('stays open when focus moves to its own controls', async () => {
    const view = await render(<MobileQuickAdd />)
    await userEvent.click(view.getByRole('button', { name: 'Quick add', exact: true }))

    await userEvent.click(view.getByRole('button', { name: 'Add as a task' }))

    await expect.element(view.getByLabelText('Quick add to today')).toBeVisible()
  })

  it('sends nothing for an empty line', async () => {
    const view = await render(<MobileQuickAdd />)
    await userEvent.click(view.getByRole('button', { name: 'Quick add', exact: true }))
    await userEvent.fill(view.getByLabelText('Quick add to today'), '   ')

    await expect.element(view.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    expect(captureInboxSpool).not.toHaveBeenCalled()
  })
})
