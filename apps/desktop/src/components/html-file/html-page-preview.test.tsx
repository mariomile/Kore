import { render } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import { HtmlPagePreview } from './html-page-preview'

const PAGE = `data:text/html,${encodeURIComponent('<title>T</title><h1>Hello</h1>')}`

describe('HtmlPagePreview', () => {
  it('runs the page sandboxed, shrunk to the cover, and drops the icon once it loads', async () => {
    const view = await render(
      <div style={{ width: 256, height: 160 }}>
        <HtmlPagePreview url={PAGE} fallback={<span>icon</span>} />
      </div>,
    )
    await expect.poll(() => view.container.querySelector('iframe')).not.toBeNull()
    const iframe = view.container.querySelector('iframe')!
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.tabIndex).toBe(-1)
    // Laid out at a laptop's width, scaled to the 256px cover.
    expect(iframe.style.width).toBe('1024px')
    expect(iframe.style.transform).toBe('scale(0.25)')
    await expect.poll(() => view.container.textContent).not.toContain('icon')
    await view.unmount()
  })
})
