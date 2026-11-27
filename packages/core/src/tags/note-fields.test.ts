import { describe, expect, it } from 'vitest'
import { hiddenNoteFieldKeys, isPanelHiddenLooseKey, withNoteFieldHidden } from './note-fields'

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

describe('hidden note fields', () => {
  it('reads none from a vault without the setting or with a malformed one', () => {
    expect(hiddenNoteFieldKeys({})).toEqual([])
    expect(hiddenNoteFieldKeys({ properties: 'nope' })).toEqual([])
    expect(hiddenNoteFieldKeys({ properties: { hiddenInNote: 'created_by' } })).toEqual([])
  })

  it('hides and shows a key, keeping every other setting', () => {
    const vault = { semantic: { excludeFolders: ['Meetings'] }, properties: { other: 1 } }
    const hidden = withNoteFieldHidden(
      withNoteFieldHidden(vault, 'updated', true),
      'created_by',
      true,
    )
    expect(hidden).toEqual({
      semantic: { excludeFolders: ['Meetings'] },
      properties: { other: 1, hiddenInNote: ['created_by', 'updated'] },
    })
    expect(hiddenNoteFieldKeys(withNoteFieldHidden(hidden, 'updated', false))).toEqual([
      'created_by',
    ])
  })

  it('stores each key once', () => {
    const twice = withNoteFieldHidden(withNoteFieldHidden({}, 'tldr', true), 'tldr', true)
    expect(hiddenNoteFieldKeys(twice)).toEqual(['tldr'])
  })
})
