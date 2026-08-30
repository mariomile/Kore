import { useState, type ReactElement } from 'react'
import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { ScrollVeil } from './scroll-veil'

function Fixture(): ReactElement {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  return (
    <div className="relative h-40 w-40">
      <div ref={setElement} data-testid="scroller" className="h-40 overflow-auto">
        <div style={{ height: 2000 }} />
      </div>
      <ScrollVeil scrollElement={element} />
    </div>
  )
}

describe('ScrollVeil', () => {
  it('stays dormant at rest and veils only while the container is scrolled', async () => {
    const view = await render(<Fixture />)
    const veil = view.container.querySelector('.app-scroll-veil')
    const scroller = view.getByTestId('scroller').element()

    // At rest nothing has scrolled under the edge — the veil must not exist
    // visually, so resting content inside its zone stays crisp.
    expect(veil).not.toBeNull()
    expect(veil!.getAttribute('data-veiled')).toBeNull()
    // Paint only: it must never intercept clicks or reach screen readers.
    expect(veil!.getAttribute('aria-hidden')).toBe('true')

    scroller.scrollTop = 300
    await vi.waitFor(() => {
      expect(veil!.getAttribute('data-veiled')).toBe('true')
    })

    scroller.scrollTop = 0
    await vi.waitFor(() => {
      expect(veil!.getAttribute('data-veiled')).toBeNull()
    })
  })
})
