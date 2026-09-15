import { describe, expect, it } from 'vitest'
import {
  TAG_SYMBOL_CATALOG,
  UNKNOWN_TAG_ICON_ERROR,
  isTagSymbolIconName,
  resolveTagIconInput,
} from './tag-icon-catalog'

describe('TAG_SYMBOL_CATALOG', () => {
  it('names every symbol once, each with a hint the model can read', () => {
    const names = TAG_SYMBOL_CATALOG.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(200)
    for (const entry of TAG_SYMBOL_CATALOG) {
      expect(entry.name).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(entry.hint).not.toBe('')
    }
    expect(isTagSymbolIconName('buildings')).toBe(true)
    expect(isTagSymbolIconName('building-2')).toBe(false)
  })
})

describe('resolveTagIconInput', () => {
  it('stores a catalog name (bare or already prefixed) as icon:<name>', () => {
    expect(resolveTagIconInput('buildings')).toEqual({ ok: true, icon: 'icon:buildings' })
    expect(resolveTagIconInput(' icon:check-circle ')).toEqual({
      ok: true,
      icon: 'icon:check-circle',
    })
  })

  it('keeps a single emoji, and refuses guessed names, words, and images', () => {
    expect(resolveTagIconInput('🏢')).toEqual({ ok: true, icon: '🏢' })
    for (const input of ['building-2', 'gavel', 'icon:gavel', 'hello', '🏢🏢', 'assets/a.png']) {
      expect(resolveTagIconInput(input)).toEqual({ ok: false, error: UNKNOWN_TAG_ICON_ERROR })
    }
  })
})
