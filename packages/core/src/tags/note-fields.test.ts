import { describe, expect, it } from 'vitest'
import { isPanelHiddenLooseKey } from './note-fields'

describe('isPanelHiddenLooseKey', () => {
  it('hides the Obsidian parent link', () => {
    expect(isPanelHiddenLooseKey('up')).toBe(true)
  })

  it('keeps every other key, including look-alikes', () => {
    for (const key of ['related', 'description', 'updated', 'Up', 'up_to', 'created_by']) {
      expect(isPanelHiddenLooseKey(key)).toBe(false)
    }
  })
})
