import { describe, expect, it } from 'vitest'
import { TAG_SYMBOL_CATALOG } from '@reflect/core'
import { TAG_SYMBOL_ICONS } from './tag-symbol-icons'

describe('TAG_SYMBOL_ICONS', () => {
  it('draws exactly the names the core catalog offers the chat model, in the same order', () => {
    // Both files are generated from one manifest; a hand edit to either
    // would let the model propose an icon the picker cannot draw (or hide
    // one it can).
    expect(Object.keys(TAG_SYMBOL_ICONS)).toEqual(TAG_SYMBOL_CATALOG.map((entry) => entry.name))
  })
})
