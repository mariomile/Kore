import { describe, expect, it } from 'vitest'
import { ADVANCED_SURFACE_NOTE_THRESHOLD, showAdvancedSurfaces } from './progressive-disclosure'

describe('showAdvancedSurfaces', () => {
  it('hides advanced chrome on a small personal graph', () => {
    expect(showAdvancedSurfaces(0, 'personal')).toBe(false)
    expect(showAdvancedSurfaces(ADVANCED_SURFACE_NOTE_THRESHOLD - 1, null)).toBe(false)
  })

  it('shows advanced chrome on a company graph or a large personal graph', () => {
    expect(showAdvancedSurfaces(0, 'company')).toBe(true)
    expect(showAdvancedSurfaces(ADVANCED_SURFACE_NOTE_THRESHOLD, 'personal')).toBe(true)
  })
})
