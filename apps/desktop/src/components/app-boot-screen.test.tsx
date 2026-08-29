import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { AppBootScreen } from './app-boot-screen'

describe('AppBootScreen', () => {
  it('announces what the app is doing while the graph opens', async () => {
    const view = await render(<AppBootScreen />)

    await expect.element(view.getByRole('status', { name: 'Opening your graph' })).toBeVisible()
  })

  it('paints the wordmark through the sheen, not as plain text', async () => {
    await render(<AppBootScreen />)

    const mark = document.querySelector('.reflect-boot-mark')
    expect(mark?.textContent).toBe('Kore')
    // The sheen clips a gradient to the glyphs; a solid color here would mean
    // the animation is painting nothing.
    expect(getComputedStyle(mark!).webkitBackgroundClip).toBe('text')
  })
})
