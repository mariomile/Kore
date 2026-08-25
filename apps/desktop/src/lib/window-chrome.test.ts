import { describe, expect, it } from 'vitest'
import { needsMacosTrafficLightInset } from './window-chrome'

describe('needsMacosTrafficLightInset', () => {
  it('indents only while the overlay lights are actually on screen', () => {
    expect(needsMacosTrafficLightInset(true, false)).toBe(true)
    expect(needsMacosTrafficLightInset(true, true)).toBe(false)
    expect(needsMacosTrafficLightInset(false, false)).toBe(false)
    expect(needsMacosTrafficLightInset(false, true)).toBe(false)
  })
})
