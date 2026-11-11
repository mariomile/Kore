import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickCaptureRoot } from './quick-capture-root'

const windowBootstrap = vi.hoisted(() =>
  vi.fn(async () => ({
    graph: { root: '/g', name: 'G', generation: 7 },
    indexGeneration: 7,
    initialDeepLink: null,
  })),
)
const captureInboxSpool = vi.hoisted(() =>
  vi.fn<(name: string, json: string, generation: number) => Promise<void>>(async () => undefined),
)
const hideQuickCapture = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  windowBootstrap,
  captureInboxSpool,
  hideQuickCapture,
}))

vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({ settings: { dateFormat: 'iso' } }),
}))

afterEach(async () => {
  await cleanup()
  vi.clearAllMocks()
})

describe('QuickCaptureRoot', () => {
  it('spools a global-shortcut line and hides', async () => {
    await render(<QuickCaptureRoot />)
    const input = page.getByLabelText("Capture a line to today's note")
    await userEvent.fill(input, 'call Alex')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))

    await vi.waitFor(() => expect(captureInboxSpool).toHaveBeenCalledTimes(1))
    const [name, json, generation] = captureInboxSpool.mock.calls[0]!
    expect(generation).toBe(7)
    expect(name).toMatch(/\.json$/)
    expect(JSON.parse(json)).toMatchObject({
      kind: 'append',
      text: 'call Alex',
      source: 'global-shortcut',
    })
    expect(hideQuickCapture).toHaveBeenCalledTimes(1)
  })

  it('hides on Escape without spooling', async () => {
    await render(<QuickCaptureRoot />)
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(hideQuickCapture).toHaveBeenCalledTimes(1))
    expect(captureInboxSpool).not.toHaveBeenCalled()
  })

  it('task mode (⌘T) spools a Quick Add task in canonical syntax', async () => {
    await render(<QuickCaptureRoot />)
    await userEvent.click(page.getByRole('button', { name: 'Task' }))
    await userEvent.fill(page.getByLabelText('Capture a task'), 'call Anna at 3pm p1')
    await expect.element(page.getByRole('list', { name: 'Understood' })).toHaveTextContent('15:00')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))

    await vi.waitFor(() => expect(captureInboxSpool).toHaveBeenCalledTimes(1))
    const envelope = JSON.parse(captureInboxSpool.mock.calls[0]![1]) as {
      kind: string
      text: string
    }
    expect(envelope.kind).toBe('task')
    expect(envelope.text).toMatch(/^!! call Anna \[\[\d{4}-\d{2}-\d{2}\]\] @15:00$/)
  })
})
