import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ACCENT_COLOR_IDS,
  DENSITY_ROW_HEIGHT,
  ACCENT_SWATCH_HEX,
  DARK_THEME_IDS,
  THEME_PREFERENCE_IDS,
  UI_RADIUS_IDS,
  type ThemePreference,
} from '@reflect/core'

/**
 * The settings schema names the themes, accents and radius steps; the design
 * system's token files are what actually paint them. Nothing links the two —
 * an id added to the enum without its `[data-…]` scope is a picker entry that
 * silently changes nothing, which is exactly the kind of half-shipped option
 * that survives review. Assert every id has a scope to land in.
 */
function tokens(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../design-system/tokens/${name}`, import.meta.url)),
    'utf8',
  )
}

const COLORS = tokens('colors.css')
const SPACING = tokens('spacing.css')

/** The pinned themes — `system` resolves to one of the others, it has no scope. */
const PINNED_THEMES = THEME_PREFERENCE_IDS.filter(
  (theme): theme is Exclude<ThemePreference, 'system'> => theme !== 'system',
)

describe('theme tokens', () => {
  it('defines a scope for every pinned theme beyond the base pair', () => {
    // `light` and `dark` are the base scopes (`:root` and `.dark`); every
    // variant on top of them needs its own `[data-theme]` block.
    for (const theme of PINNED_THEMES) {
      if (theme === 'light' || theme === 'dark') {
        continue
      }
      expect(COLORS, theme).toContain(`[data-theme='${theme}']`)
    }
  })

  it('classifies every pinned theme as light or dark exactly once', () => {
    for (const theme of DARK_THEME_IDS) {
      expect(PINNED_THEMES).toContain(theme)
    }
    expect(new Set(DARK_THEME_IDS).size).toBe(DARK_THEME_IDS.length)
  })

  it('gives dark inverse calendar surfaces a light square and dark number', () => {
    // House `dark` used to paint the selected day with the brand indigo
    // (`#7b7ef4`), so the calendar was the one chrome surface that ignored
    // the grayscale selection idiom. Inverse of `--text` / `--surface`.
    const dark = /\n\.dark \{\n([^}]*)\}/.exec(COLORS)?.[1]
    expect(dark).toBeDefined()
    expect(dark).toMatch(/--surface-inverse:\s*#[def][0-9a-f]{5};/)
    expect(dark).toMatch(/--text-on-inverse:\s*#[0-5][0-9a-f]{5};/)
    expect(dark).not.toMatch(/--surface-inverse:\s*#7b7ef4;/)

    for (const theme of ['ink', 'graphite']) {
      const scope = new RegExp(String.raw`\[data-theme='${theme}']\s*\{([^}]*)}`).exec(COLORS)?.[1]
      expect(scope, theme).toBeDefined()
      expect(scope, theme).toMatch(/--surface-inverse:\s*#[def][0-9a-f]{5};/)
      expect(scope, theme).toMatch(/--text-on-inverse:\s*#[0-5][0-9a-f]{5};/)
    }
  })

  it('gives every accent a distinct value in both families', () => {
    // Two ids that resolve to the same `--accent` are two picker swatches that
    // do nothing different — the kind of thing only a side-by-side catches.
    // `indigo` is the base ramp and has no scope of its own, so each family is
    // seeded from the block that declares its default.
    const accentIn = (selector: string): string | undefined =>
      new RegExp(String.raw`${selector}\s*\{[^}]*?--accent:\s*([^;]+);`).exec(COLORS)?.[1]?.trim()
    const families = [
      { name: 'light', base: ':root', scope: ':root' },
      { name: 'dark', base: String.raw`\.dark`, scope: String.raw`:root\.dark` },
    ]
    for (const family of families) {
      const values = new Map<string, string>()
      const base = accentIn(family.base)
      expect(base, `indigo (${family.name})`).toBeDefined()
      values.set(base as string, 'indigo')
      for (const accent of ACCENT_COLOR_IDS) {
        if (accent === 'indigo') {
          continue
        }
        const value = accentIn(String.raw`${family.scope}\[data-accent='${accent}']`)
        expect(value, `${accent} (${family.name})`).toBeDefined()
        expect(values.get(value as string), `${accent} (${family.name}) duplicates`).toBeUndefined()
        values.set(value as string, accent)
      }
      expect(values.size, family.name).toBe(ACCENT_COLOR_IDS.length)
    }
  })

  it('keeps every swatch hex distinct', () => {
    const hexes = Object.values(ACCENT_SWATCH_HEX)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('defines a scope and a swatch for every preset accent', () => {
    for (const accent of ACCENT_COLOR_IDS) {
      // Indigo is the house ramp: it *is* the base `--accent`, so it has no
      // override scope of its own.
      if (accent !== 'indigo') {
        expect(COLORS, accent).toContain(`[data-accent='${accent}']`)
      }
      expect(ACCENT_SWATCH_HEX[accent]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('keeps the elevation ladder owned by colors.css alone', () => {
    // styles.css imports colors.css then spacing.css, and `:root` in the
    // second file ties with `.dark` in the first — so a `:root` copy of these
    // in spacing.css silently wins everywhere and the dark elevations never
    // render. They did not, for a while. One owner, next to the themes.
    for (const tier of ['--shadow-sm', '--shadow-md', '--shadow-pop']) {
      expect(SPACING, `${tier} must not be redeclared in spacing.css`).not.toContain(`${tier}:`)
      expect(COLORS.split(`${tier}:`).length - 1, `${tier} light + dark`).toBeGreaterThanOrEqual(2)
    }
  })

  it('defines a radius scope for every step but the house default', () => {
    for (const radius of UI_RADIUS_IDS) {
      if (radius === 'default') {
        expect(SPACING).not.toContain(`[data-radius='${radius}']`)
        continue
      }
      expect(SPACING, radius).toContain(`[data-radius='${radius}']`)
    }
  })

  it('defines a density scope for every step but the default, with the JS number', () => {
    // The All Notes virtualizer reads DENSITY_ROW_HEIGHT as a number while the
    // row's height comes from the CSS scope; if the two drift, rows overlap.
    for (const [density, rowHeight] of Object.entries(DENSITY_ROW_HEIGHT)) {
      if (density === 'default') {
        expect(SPACING).not.toContain(`[data-density='${density}']`)
        // The default is the base :root value.
        expect(SPACING).toContain(`--row-height: ${rowHeight}px`)
        continue
      }
      const scope = new RegExp(String.raw`\[data-density='${density}']\s*\{([^}]*)}`).exec(
        SPACING,
      )?.[1]
      expect(scope, density).toBeDefined()
      expect(scope, density).toContain(`--row-height: ${rowHeight}px`)
    }
  })

  it('has every radius scope restate --radius', () => {
    // The desktop app re-derives its whole Tailwind `rounded-*` ramp from the
    // single `--radius` value, so a scope that only sets `--radius-md` and
    // friends would move the design system's surfaces and not the app's.
    for (const radius of UI_RADIUS_IDS) {
      if (radius === 'default') {
        continue
      }
      const scope = new RegExp(String.raw`\[data-radius='${radius}']\s*\{([^}]*)}`).exec(
        SPACING,
      )?.[1]
      expect(scope, radius).toBeDefined()
      expect(scope, radius).toMatch(/^\s*(?:\/\*[\s\S]*?\*\/\s*)*--radius:/)
    }
  })

  it('derives the whole radius ramp from --radius, so a scope sets nothing else', () => {
    // Two ramps used to disagree (the DS said md = 7px, the rounded-* utilities
    // 6px) and each scope carried a hand-written table. One formula now.
    for (const step of ['sm', 'md', 'lg', 'xl', '2xl']) {
      expect(SPACING, step).toMatch(new RegExp(String.raw`--radius-${step}:[^;]*var\(--radius\)`))
    }
    for (const radius of UI_RADIUS_IDS) {
      const scope = new RegExp(String.raw`\[data-radius='${radius}']\s*\{([^}]*)}`).exec(
        SPACING,
      )?.[1]
      expect(scope ?? '', radius).not.toMatch(/--radius-/)
    }
  })
})

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

/** The hex a token resolves to in a scope, falling back to its family's base. */
function hexIn(scopes: string[], token: string): string | undefined {
  for (const scope of scopes) {
    const value = new RegExp(String.raw`(?:^|\n)\s*--${token}:\s*(#[0-9a-f]{6});`).exec(scope)?.[1]
    if (value) {
      return value
    }
  }
  return undefined
}

describe('theme contrast floors', () => {
  // docs/design.md promises 4.5:1 for primary and secondary text and 3:1 for
  // muted meta text, on the card and on the page. Space paints its text with
  // alpha over a purple ground, so only the solid-color themes are checked.
  const block = (selector: string): string =>
    new RegExp(String.raw`(?:^|\n)${selector} \{([^}]*)}`).exec(COLORS)?.[1] ?? ''
  const light = block(':root')
  const dark = block(String.raw`\.dark`)
  const themes: Record<string, string[]> = {
    light: [light],
    ash: [block(String.raw`:root\[data-theme='ash']`), light],
    paper: [block(String.raw`:root\[data-theme='paper']`), light],
    dark: [dark],
    graphite: [block(String.raw`:root\[data-theme='graphite']`), dark],
    ink: [block(String.raw`:root\[data-theme='ink']`), dark],
    midnight: [block(String.raw`:root\[data-theme='midnight']`), dark],
    codex: [block(String.raw`:root\[data-theme='codex']`), dark],
  }

  for (const [theme, scopes] of Object.entries(themes)) {
    it(`${theme} text and status inks clear their floors`, () => {
      const floors: Array<[string, number]> = [
        ['text', 4.5],
        ['text-secondary', 4.5],
        ['text-muted', 3],
        ['danger', 4.5],
        ['warning', 4.5],
        ['success', 4.5],
      ]
      for (const ground of ['surface', 'surface-app']) {
        const bg = hexIn(scopes, ground)
        expect(bg, `${theme} --${ground}`).toBeDefined()
        for (const [token, floor] of floors) {
          const fg = hexIn(scopes, token)
          expect(fg, `${theme} --${token}`).toBeDefined()
          expect(
            contrast(fg ?? '', bg ?? ''),
            `${theme} --${token} on --${ground}`,
          ).toBeGreaterThanOrEqual(floor)
        }
      }
    })
  }

  it('fills stock dark indigo deep enough for a white label', () => {
    expect(contrast(hexIn([dark], 'accent-fill') ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
