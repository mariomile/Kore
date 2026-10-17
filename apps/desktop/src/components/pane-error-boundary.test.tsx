import { useState, type ReactElement } from 'react'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@reflect/core'
import { PaneErrorBoundary } from './pane-error-boundary'

const crash = { active: false }

function FragileNote(): ReactElement {
  if (crash.active) {
    throw new Error('convertFileSrc is not available')
  }
  return <p>Note body</p>
}

function Workspace({ resetKey }: { resetKey: string }): ReactElement {
  const [clicks, setClicks] = useState(0)
  return (
    <div>
      <button type="button" onClick={() => setClicks((count) => count + 1)}>
        Sidebar clicks: {clicks}
      </button>
      <PaneErrorBoundary resetKey={resetKey} surface="note" path="notes/broken.md">
        <FragileNote />
      </PaneErrorBoundary>
    </div>
  )
}

describe('PaneErrorBoundary', () => {
  let logged: unknown[] = []

  beforeEach(() => {
    logged = []
    setBridge({
      invoke: async (command, args) => {
        if (command === 'log_webview') {
          logged.push(args)
        }
        return null
      },
      listen: async () => () => {},
    })
    // React reports every caught render error to the console as well.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    await cleanup()
    setBridge(null)
    vi.restoreAllMocks()
  })

  it('keeps a crash inside its pane, logs it, and recovers on reload', async () => {
    crash.active = true
    await render(<Workspace resetKey="note:a" />)

    await expect.element(page.getByText('This note couldn’t be shown')).toBeVisible()
    await expect.element(page.getByText('convertFileSrc is not available')).toBeVisible()
    await vi.waitFor(() => {
      expect(logged).toContainEqual({
        level: 'error',
        message: expect.stringContaining('pane crashed (notes/broken.md)'),
      })
    })

    await page.getByRole('button', { name: 'Sidebar clicks: 0' }).click()
    await expect.element(page.getByRole('button', { name: 'Sidebar clicks: 1' })).toBeVisible()

    crash.active = false
    await page.getByRole('button', { name: 'Reload pane' }).click()
    await expect.element(page.getByText('Note body')).toBeVisible()
  })

  it('clears the card when the pane navigates elsewhere', async () => {
    crash.active = true
    const screen = await render(<Workspace resetKey="note:a" />)
    await expect.element(page.getByText('This note couldn’t be shown')).toBeVisible()

    crash.active = false
    await screen.rerender(<Workspace resetKey="note:b" />)
    await expect.element(page.getByText('Note body')).toBeVisible()
  })
})
