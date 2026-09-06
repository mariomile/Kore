import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { AppBootScreen } from './app-boot-screen'

describe('AppBootScreen', () => {
  it('announces what the app is doing while the graph opens', async () => {
    const view = await render(<AppBootScreen />)

    await expect.element(view.getByRole('status', { name: 'Opening your graph' })).toBeVisible()
  })

  it('paints the gem mark at splash scale, not the boxed app icon', async () => {
    const view = await render(<AppBootScreen />)

    const mark = view.getByRole('status', { name: 'Opening your graph' }).element()
    const img = mark.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src') ?? '').toContain('kore-mark')
    expect(img?.className).toContain('h-24')
  })
})
