import type {
  AccentColor,
  GlassIntensity,
  ThemePreference,
  UiDensity,
  UiRadius,
} from '@reflect/core'

/**
 * Where the theme preference is mirrored for the *next* launch.
 *
 * The settings document is the source of truth, but it loads over IPC — too
 * late for the first paint. `public/theme-init.js` reads this key before the
 * design-system CSS is evaluated so a user who pinned `light` or `dark` never
 * sees the OS theme painted first. That script is served raw (no bundling, so
 * no imports), which is why the key literal is repeated there;
 * `theme-cache.test.ts` guards against the two drifting apart.
 */
export const THEME_PREFERENCE_CACHE_KEY = 'reflect.theme.preference'

/**
 * Mirror the persisted theme preference so the next launch can apply it before
 * the frontend boots.
 *
 * The *preference* is cached rather than the resolved `light`/`dark`: a user on
 * `system` whose OS theme changed while the app was closed must re-resolve from
 * `prefers-color-scheme`, not replay a stale answer. Best-effort — a webview
 * with storage unavailable just falls back to the OS preference.
 */
export function writeCachedThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, preference)
  } catch {
    // Storage is unavailable; theme-init.js falls back to `prefers-color-scheme`.
  }
}

/**
 * Where the accent color is mirrored for the next launch, same contract as
 * {@link THEME_PREFERENCE_CACHE_KEY}: `public/theme-init.js` repeats this
 * literal because it cannot import, and `theme-cache.test.ts` guards the pair.
 */
export const THEME_ACCENT_CACHE_KEY = 'reflect.theme.accent'

/**
 * Mirror the persisted accent color so the next launch's first paint already
 * carries it. Best-effort like the preference mirror — an unreadable cache
 * just paints the default (indigo) accent until settings load.
 */
export function writeCachedAccentColor(accentColor: AccentColor): void {
  try {
    localStorage.setItem(THEME_ACCENT_CACHE_KEY, accentColor)
  } catch {
    // Storage is unavailable; theme-init.js paints the default accent.
  }
}

/**
 * Where the Liquid Glass switch is mirrored for the next launch, same
 * contract as {@link THEME_PREFERENCE_CACHE_KEY}: `public/theme-init.js`
 * repeats this literal because it cannot import, and `theme-cache.test.ts`
 * guards the pair.
 */
export const THEME_GLASS_CACHE_KEY = 'reflect.theme.glass'

/**
 * Mirror the persisted Liquid Glass switch so the first painted frame already
 * carries the glass backdrop. Best-effort like the other mirrors — an
 * unreadable cache just paints opaque surfaces until settings load.
 */
export function writeCachedLiquidGlass(enabled: boolean): void {
  try {
    localStorage.setItem(THEME_GLASS_CACHE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Storage is unavailable; the first frame paints without glass.
  }
}

/**
 * Where the corner-radius choice is mirrored for the next launch, same
 * contract as {@link THEME_PREFERENCE_CACHE_KEY}: `public/theme-init.js`
 * repeats this literal because it cannot import, and `theme-cache.test.ts`
 * guards the pair.
 */
export const THEME_RADIUS_CACHE_KEY = 'reflect.theme.radius'

/**
 * Mirror the persisted corner radius so the first painted frame already has
 * the right geometry — the radius scope rescales every surface, so applying
 * it late visibly re-shapes the whole window. Best-effort like the other
 * mirrors; an unreadable cache paints the house 8px default.
 */
export function writeCachedUiRadius(radius: UiRadius): void {
  try {
    localStorage.setItem(THEME_RADIUS_CACHE_KEY, radius)
  } catch {
    // Storage is unavailable; the first frame paints the default radius.
  }
}

/**
 * Where the Liquid Glass intensity is mirrored for the next launch, same
 * contract as {@link THEME_PREFERENCE_CACHE_KEY}: `public/theme-init.js`
 * repeats this literal because it cannot import, and `theme-cache.test.ts`
 * guards the pair.
 */
export const THEME_GLASS_LEVEL_CACHE_KEY = 'reflect.theme.glass-level'

/**
 * Mirror the persisted Liquid Glass intensity. Only consulted when the glass
 * mirror says `on`; an unreadable cache paints the `regular` intensity.
 */
export function writeCachedGlassIntensity(intensity: GlassIntensity): void {
  try {
    localStorage.setItem(THEME_GLASS_LEVEL_CACHE_KEY, intensity)
  } catch {
    // Storage is unavailable; the first frame paints the regular intensity.
  }
}

/**
 * Where the UI density is mirrored for the next launch, same contract as
 * {@link THEME_PREFERENCE_CACHE_KEY}: `public/theme-init.js` repeats this
 * literal because it cannot import, and `theme-cache.test.ts` guards the pair.
 */
export const THEME_DENSITY_CACHE_KEY = 'reflect.theme.density'

/**
 * Mirror the persisted density so rows are the right height on the first
 * painted frame. Best-effort like the other mirrors; an unreadable cache
 * paints the default density until settings load.
 */
export function writeCachedUiDensity(density: UiDensity): void {
  try {
    localStorage.setItem(THEME_DENSITY_CACHE_KEY, density)
  } catch {
    // Storage is unavailable; the first frame paints the default density.
  }
}
