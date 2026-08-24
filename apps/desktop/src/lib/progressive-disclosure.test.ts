import { describe, expect, it } from 'vitest'
import { ADVANCED_SURFACE_NOTE_THRESHOLD, showAdvancedSurfaces } from './progressive-disclosure'

describe('showAdvancedSurfaces', () => {
  it('hides advanced chrome on a small graph', () => {
    expect(showAdvancedSurfaces(0)).toBe(false)
    expect(showAdvancedSurfaces(ADVANCED_SURFACE_NOTE_THRESHOLD - 1)).toBe(false)
  })

  it('shows advanced chrome once the graph has enough notes', () => {
    expect(showAdvancedSurfaces(ADVANCED_SURFACE_NOTE_THRESHOLD)).toBe(true)
  })
})
