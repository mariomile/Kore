import { CSS } from '@dnd-kit/utilities'
import { describe, expect, it } from 'vitest'
import { sortableTranslateStyle } from './sortable-translate'

describe('sortableTranslateStyle', () => {
  it('omits scale so mixed-height shelves do not enlarge', () => {
    const transform = { x: 0, y: 40, scaleX: 2.5, scaleY: 3 }
    const style = sortableTranslateStyle(transform, 'transform 200ms')
    expect(style.transform).not.toMatch(/scale/)
    expect(style.transform).toBe(CSS.Translate.toString(transform))
    expect(CSS.Transform.toString(transform)).toMatch(/scale/)
    expect(style.transition).toBe('transform 200ms')
  })
})
