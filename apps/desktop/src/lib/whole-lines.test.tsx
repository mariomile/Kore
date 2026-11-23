import { afterEach, describe, expect, it } from 'vitest'
import { lastWholeLineBottom } from './whole-lines'

const LINE = 20

function box(height: number, html: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `width: 200px; height: ${height}px; overflow: hidden; font: 12px/${LINE}px sans-serif;`
  el.innerHTML = html
  document.body.append(el)
  return el
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `<p style="margin:0">line ${index}</p>`).join(
    '',
  )
}

describe('lastWholeLineBottom', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('is null when the text fits', () => {
    expect(lastWholeLineBottom(box(3 * LINE, lines(3)))).toBeNull()
  })

  it('is null when there is no text to end on', () => {
    expect(lastWholeLineBottom(box(50, '<div style="height:200px"></div>'))).toBeNull()
  })

  it('ends on the last line that fits when a line is cut', () => {
    const el = box(2.5 * LINE, lines(5))
    const { top } = el.getBoundingClientRect()
    const bottom = lastWholeLineBottom(el)
    expect(bottom).not.toBeNull()
    // The second line's text ends inside its 20px line box.
    expect(bottom! - top).toBeGreaterThan(LINE)
    expect(bottom! - top).toBeLessThanOrEqual(2 * LINE)
  })

  it('ends on the last line that fits when the cut falls between lines', () => {
    const el = box(2 * LINE, lines(5))
    const { top } = el.getBoundingClientRect()
    expect(lastWholeLineBottom(el)! - top).toBeLessThanOrEqual(2 * LINE)
    expect(lastWholeLineBottom(el)! - top).toBeGreaterThan(LINE)
  })

  it('does not end on smaller text of the line that is cut', () => {
    const el = box(
      2.5 * LINE,
      `${lines(2)}<p style="margin:0"><span style="font-size:6px;vertical-align:top">x</span>line 2</p>`,
    )
    const { top } = el.getBoundingClientRect()
    expect(lastWholeLineBottom(el)! - top).toBeLessThanOrEqual(2 * LINE)
  })
})
