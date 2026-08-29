import { z } from 'zod'

/**
 * The app color theme. `system` (the default) follows the OS preference;
 * every other value pins a concrete variant.
 *
 * The set is deliberately sober — neutral greys in the register the tools
 * this app sits beside use (Cursor, Codex, Notion, Craft), not a palette of
 * hues. Light: `light` (pure white), `ash` (neutral grey page under white
 * cards), `paper` (warm cream). Dark: `dark` (the house cool charcoal),
 * `graphite` (a flat neutral grey), `ink` (`paper`'s warm counterpart — the
 * one dark variant that reads as a notebook rather than an editor), `space`
 * (the marketing site's deep-space purple), `midnight` (pure-black OLED).
 * Colour comes from the accent, which is a separate setting, so the surfaces
 * can stay quiet.
 *
 * Persisted here so the choice survives relaunch. Listed in picker order:
 * the OS default, then light to dark.
 */
const themePreferenceEnum = z.enum([
  'system',
  'light',
  'ash',
  'paper',
  'dark',
  'graphite',
  'ink',
  'space',
  'midnight',
])

export const themePreferenceSchema = themePreferenceEnum.catch('system')

export type ThemePreference = z.infer<typeof themePreferenceSchema>

/** Every theme id, `system` included. */
export const THEME_PREFERENCE_IDS = themePreferenceEnum.options

/**
 * The pinned variants that layer over the dark scope. The single source of
 * truth for the `.dark` class, `color-scheme`, and the light/dark toggle —
 * `public/theme-init.js` repeats the list because it cannot import.
 */
export const DARK_THEME_IDS: readonly ThemePreference[] = [
  'dark',
  'graphite',
  'ink',
  'space',
  'midnight',
]

/**
 * The app accent color — the one saturated hue used for solid buttons,
 * selection, focus, and today's daily-note heading. `indigo` (the default)
 * keeps the stock Reflect brand ramp; any other id remaps the accent tokens
 * app-wide via a `data-accent` attribute on the document root. A closed set of
 * named ids — not raw hex — so each id can carry hand-tuned values that read
 * well in both light and dark themes.
 */
const accentColorEnum = z.enum([
  // Ordered as the picker lays them out: one turn around the wheel from
  // indigo, then the neutral.
  'indigo',
  'violet',
  'purple',
  'pink',
  'rose',
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'slate',
  'custom',
])

export const accentColorSchema = accentColorEnum.catch('indigo')

export type AccentColor = z.infer<typeof accentColorSchema>

/** The preset accent ids, in picker order — `custom` renders as its own swatch. */
export const ACCENT_COLOR_IDS = accentColorEnum.options.filter(
  (id): id is Exclude<AccentColor, 'custom'> => id !== 'custom',
)

/** The stock indigo accent — the custom color's starting value. */
export const DEFAULT_CUSTOM_ACCENT = '#4f46e5'

/**
 * Preset accent swatch colors for pickers, one definition for every surface.
 * These mirror the 500-weight `--accent` values in
 * `design-system/tokens/colors.css` — tune the ramp there first, then here.
 */
export const ACCENT_SWATCH_HEX: Record<Exclude<AccentColor, 'custom'>, string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  purple: '#9333ea',
  pink: '#db2777',
  rose: '#e11d48',
  red: '#dc2626',
  orange: '#ea580c',
  amber: '#d97706',
  lime: '#65a30d',
  green: '#059669',
  emerald: '#10b981',
  teal: '#0d9488',
  cyan: '#0891b2',
  sky: '#0284c7',
  blue: '#2563eb',
  slate: '#475569',
}

/**
 * The hex color applied when {@link accentColorSchema} is `custom`. Stored
 * normalized to lowercase `#rrggbb`; an invalid value degrades to the stock
 * indigo so a hand-edit can't paint the app with an unparsable color.
 */
export const customAccentColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((value) => value.toLowerCase())
  .catch(DEFAULT_CUSTOM_ACCENT)

/**
 * Liquid Glass: translucent, blurred chrome over an accent-tinted backdrop.
 * Orthogonal to the theme — it restyles the surfaces of whichever theme is
 * active rather than being a theme of its own. Off by default.
 */
export const liquidGlassSchema = z.boolean().catch(false)

/**
 * How far Liquid Glass goes when it is on: `subtle` barely tints and blurs
 * (readable on a busy vault), `regular` is the original look, and `strong`
 * leans into the backdrop. A separate key from the on/off switch so turning
 * glass off and back on returns to the intensity the user chose. Ignored
 * entirely while {@link liquidGlassSchema} is false.
 */
const glassIntensityEnum = z.enum(['subtle', 'regular', 'strong'])

export const glassIntensitySchema = glassIntensityEnum.catch('regular')

export type GlassIntensity = z.infer<typeof glassIntensitySchema>

/** The intensities in picker order, faintest first. */
export const GLASS_INTENSITY_IDS = glassIntensityEnum.options

/**
 * How round the app's corners are. Scales the whole radius ramp through a
 * `data-radius` scope on the document root (see the design system's
 * `spacing.css`) rather than restyling components one by one, so every
 * surface — buttons, cards, dialogs, chips — moves together. `default` is
 * the house 8px geometry.
 */
const uiRadiusEnum = z.enum(['sharp', 'small', 'default', 'round'])

export const uiRadiusSchema = uiRadiusEnum.catch('default')

export type UiRadius = z.infer<typeof uiRadiusSchema>

/** The radius steps in picker order, squarest first. */
export const UI_RADIUS_IDS = uiRadiusEnum.options

/**
 * How tightly the app packs its rows. Deliberately narrower than "scale every
 * spacing token": the app styles with Tailwind utilities, not the design
 * system's `--space-*` scale (which it never reads), and rescaling Tailwind's
 * base unit would also resize icons and desync the list virtualizers, whose
 * row heights are numbers in JS. So density is a `data-density` scope in the
 * design system (`spacing.css`), like the radius setting — plus
 * {@link DENSITY_ROW_HEIGHT} for the one consumer that needs the value as a
 * number. A token test asserts the two stay equal.
 */
const uiDensityEnum = z.enum(['compact', 'default', 'comfortable'])

export const uiDensitySchema = uiDensityEnum.catch('default')

export type UiDensity = z.infer<typeof uiDensitySchema>

/** The densities in picker order, tightest first. */
export const UI_DENSITY_IDS = uiDensityEnum.options

/**
 * The interface (chrome) text size. Display-only — mapped to a root
 * font-size scale through a `data-ui-text-size` scope on the document root
 * (see `styles/index.css`), so every rem-based size in the app moves
 * together. `default` keeps the browser's 16px root.
 */
const uiTextSizeEnum = z.enum(['small', 'default', 'large'])

export const uiTextSizeSchema = uiTextSizeEnum.catch('default')

export type UiTextSize = z.infer<typeof uiTextSizeSchema>

/** The interface text sizes in picker order, smallest first. */
export const UI_TEXT_SIZE_IDS = uiTextSizeEnum.options

/**
 * The AI chat's reading text size. Same contract as the editor's
 * `editorTextSize`: display-only, mapped to the `--chat-font-size` variable
 * through a `data-chat-text-size` scope on the document root, applied by
 * `ChatTextSizeEffect`. `medium` is the chat's stock 14px chrome size.
 */
const chatTextSizeEnum = z.enum(['small', 'medium', 'large'])

export const chatTextSizeSchema = chatTextSizeEnum.catch('medium')

export type ChatTextSize = z.infer<typeof chatTextSizeSchema>

/** The chat text sizes in picker order, smallest first. */
export const CHAT_TEXT_SIZE_IDS = chatTextSizeEnum.options

/**
 * Each density's list-row height, in pixels. The CSS side owns the same value
 * through the `[data-density]` scopes in `spacing.css`; this map exists for
 * the All Notes virtualizer, which needs it as a number (it feeds `itemSize`,
 * and a row that renders taller than the virtualizer believes overlaps its
 * neighbour). `theme-tokens.test.ts` fails the build if the two drift.
 */
export const DENSITY_ROW_HEIGHT: Record<UiDensity, number> = {
  compact: 40,
  default: 48,
  comfortable: 56,
}

/**
 * How times of day are displayed throughout the app. `12h` (the default)
 * renders `8:22pm`; `24h` renders `20:22`. Display-only — stored timestamps
 * and daily-note keys are unaffected.
 */
export const timeFormatSchema = z.enum(['12h', '24h']).catch('12h')

export type TimeFormat = z.infer<typeof timeFormatSchema>

/**
 * How calendar dates are displayed throughout the app: `mdy` (the default)
 * renders `June 10th, 2026`, `dmy` renders `10th June 2026`, and `iso`
 * renders `2026-06-10`. Display-only — daily-note filenames and stored dates
 * stay ISO `YYYY-MM-DD` regardless.
 */
export const dateFormatSchema = z.enum(['mdy', 'dmy', 'iso']).catch('mdy')

export type DateFormat = z.infer<typeof dateFormatSchema>

/**
 * Which day opens the calendar week. `monday` (the default) follows ISO 8601;
 * `sunday` matches the North-American convention; `saturday` matches the
 * convention of most Middle-East and North-Africa locales.
 */
export const weekStartDaySchema = z.enum(['monday', 'sunday', 'saturday']).catch('monday')

export type WeekStartDay = z.infer<typeof weekStartDaySchema>

const WEEK_START_DOW: Record<WeekStartDay, 0 | 1 | 6> = { sunday: 0, monday: 1, saturday: 6 }

/**
 * The week-start day in JS `getDay()` numbering (0 = Sunday, 6 = Saturday),
 * which is also date-fns' `weekStartsOn` convention.
 */
export function weekStartDow(weekStartDay: WeekStartDay): 0 | 1 | 6 {
  return WEEK_START_DOW[weekStartDay]
}
