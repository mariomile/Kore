import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_COLOR_IDS, DARK_THEME_IDS, UI_RADIUS_IDS } from '@reflect/core'
import {
  THEME_ACCENT_CACHE_KEY,
  THEME_GLASS_LEVEL_CACHE_KEY,
  THEME_DENSITY_CACHE_KEY,
  THEME_PREFERENCE_CACHE_KEY,
  THEME_RADIUS_CACHE_KEY,
  VISUAL_THEME_CACHE_KEY,
} from './theme-cache'

/**
 * `public/theme-init.js` is served raw — no bundler, so it cannot import the
 * cache key and has to repeat the literal. Renaming the key here without
 * updating that script would silently stop the early theme paint from finding
 * the cached preference, reverting every launch to the OS preference. Assert
 * the two agree instead.
 */
const THEME_INIT_PATH = fileURLToPath(new URL('../../public/theme-init.js', import.meta.url))

describe('THEME_PREFERENCE_CACHE_KEY', () => {
  it('matches the key the early theme script reads', () => {
    const script = readFileSync(THEME_INIT_PATH, 'utf8')
    expect(script).toContain(`'${THEME_PREFERENCE_CACHE_KEY}'`)
  })
})

describe('THEME_ACCENT_CACHE_KEY', () => {
  it('matches the key the early theme script reads', () => {
    const script = readFileSync(THEME_INIT_PATH, 'utf8')
    expect(script).toContain(`'${THEME_ACCENT_CACHE_KEY}'`)
  })
})

describe('VISUAL_THEME_CACHE_KEY', () => {
  it('matches the key the early theme script reads', () => {
    const script = readFileSync(THEME_INIT_PATH, 'utf8')
    expect(script).toContain(`'${VISUAL_THEME_CACHE_KEY}'`)
  })
})

describe('THEME_RADIUS_CACHE_KEY', () => {
  it('matches the key the early theme script reads', () => {
    const script = readFileSync(THEME_INIT_PATH, 'utf8')
    expect(script).toContain(`'${THEME_RADIUS_CACHE_KEY}'`)
  })
})

describe('THEME_GLASS_LEVEL_CACHE_KEY', () => {
  it('matches the key the early theme script reads', () => {
    const script = readFileSync(THEME_INIT_PATH, 'utf8')
    expect(script).toContain(`'${THEME_GLASS_LEVEL_CACHE_KEY}'`)
  })
})

/**
 * The early script also repeats the *value* lists — the accents it will honour,
 * the themes it treats as dark, the radius scopes. A new accent added to the
 * schema but not here is silently dropped on the first paint and only appears
 * once settings load, which reads as a flash. Assert the lists agree.
 */
describe('theme-init value lists', () => {
  const script = readFileSync(THEME_INIT_PATH, 'utf8')

  it('honours every preset accent', () => {
    for (const accent of ACCENT_COLOR_IDS) {
      expect(script).toContain(`'${accent}'`)
    }
  })

  it('treats every dark variant as dark', () => {
    const darkList = /const DARK_THEMES = \[([^\]]*)\]/.exec(script)?.[1] ?? ''
    for (const theme of DARK_THEME_IDS) {
      expect(darkList).toContain(`'${theme}'`)
    }
  })

  it('carries every non-default radius scope', () => {
    const radiusList = /const RADII = \[([^\]]*)\]/.exec(script)?.[1] ?? ''
    for (const radius of UI_RADIUS_IDS) {
      if (radius === 'default') {
        continue
      }
      expect(radiusList).toContain(`'${radius}'`)
    }
    expect(radiusList).not.toContain(`'default'`)
  })
})

describe('THEME_DENSITY_CACHE_KEY', () => {
  it('matches the key the early theme script reads', () => {
    const script = readFileSync(THEME_INIT_PATH, 'utf8')
    expect(script).toContain(`'${THEME_DENSITY_CACHE_KEY}'`)
  })
})
