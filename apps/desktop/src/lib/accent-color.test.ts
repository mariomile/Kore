import { describe, expect, it } from 'vitest'
import { deriveAccentTokens, hexWithAlpha, mixHex } from './accent-color'

describe('mixHex', () => {
  it('mixes toward white and black', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#4f46e5', '#ffffff', 0)).toBe('#4f46e5')
    expect(mixHex('#4f46e5', '#000000', 1)).toBe('#000000')
  })
})

describe('hexWithAlpha', () => {
  it('renders an rgba with the channel values', () => {
    expect(hexWithAlpha('#4f46e5', 0.16)).toBe('rgba(79, 70, 229, 0.16)')
  })
})

describe('deriveAccentTokens', () => {
  it('keeps the hex as the accent and focus ring', () => {
    const tokens = deriveAccentTokens('#0d9488', false)
    expect(tokens.accent).toBe('#0d9488')
    expect(tokens.focusRing).toBe('#0d9488')
  })

  it('flips the soft-text direction per family', () => {
    const light = deriveAccentTokens('#0d9488', false)
    const dark = deriveAccentTokens('#0d9488', true)
    expect(light.accentSoftText).not.toBe(dark.accentSoftText)
    expect(dark.accentSoft).toContain('0.28')
    expect(light.accentSoft).toContain('0.16')
  })
})
