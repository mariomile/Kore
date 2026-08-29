import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { MobileScreenHeader } from './screen-header'

describe('MobileScreenHeader', () => {
  it('centers the title between balanced header action slots', async () => {
    const view = await render(
      <MobileScreenHeader
        title="Roadmap"
        onBack={vi.fn()}
        trailing={<button type="button" aria-label="More actions" />}
      />,
    )

    const header = view.container.querySelector('header')
    if (header === null) {
      throw new Error('expected a header')
    }
    // The header floats as a glass bar; the balanced grid row lives inside
    // it, under the safe-area padding the bar owns.
    expect(Array.from(header.classList)).toContain('mobile-glass-bar')
    const row = header.firstElementChild
    if (row === null) {
      throw new Error('expected the header row')
    }
    expect(Array.from(row.classList)).toContain('grid')
    expect(Array.from(row.classList)).toContain('h-11')
    expect(Array.from(row.classList)).toContain('grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]')
    expect(Array.from(row.classList)).toContain('items-center')

    expect(Array.from(view.getByRole('button', { name: 'Back' }).element().classList)).toContain(
      'justify-self-center',
    )
    expect(
      Array.from(view.getByRole('heading', { name: 'Roadmap' }).element().classList),
    ).toContain('text-center')
  })
})
