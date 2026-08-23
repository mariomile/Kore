import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { DARK_THEME_IDS, type ThemePreference } from '@reflect/core'
import { deriveAccentTokens } from '@/lib/accent-color'
import {
  writeCachedAccentColor,
  writeCachedGlassIntensity,
  writeCachedLiquidGlass,
  writeCachedThemePreference,
  writeCachedUiDensity,
  writeCachedUiRadius,
} from '@/lib/theme-cache'
import { useSettings, type SettingsLoadOutcome } from '@/providers/settings-provider'

/** User-selectable theme; `system` follows the OS preference. */
export type Theme = ThemePreference

/** The concrete theme actually applied to the document. */
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

/**
 * Whether a resolved theme belongs to the dark family. `graphite`, `space`
 * and `midnight` are dark variants — they layer over the `.dark` scope —
 * while `ash` and `paper` are light ones. Family drives the `.dark`
 * class (and with it every Tailwind `dark:` utility), the CSS `color-scheme`,
 * and the light/dark toggle. The list itself lives in the settings schema
 * next to the theme enum, so adding a variant can't forget this.
 */
export function isDarkResolvedTheme(theme: ResolvedTheme): boolean {
  return DARK_THEME_IDS.includes(theme)
}

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

interface ThemeProviderProps {
  children: ReactNode
}

/**
 * Provides the app theme and applies it by toggling the design-system `.dark`
 * scope on the document root. The preference lives in the settings document
 * (the `theme` key), so a choice made anywhere — settings screen, palette
 * command — persists across launches; `system` reacts to live OS changes.
 *
 * Applying the theme waits for the settings load to settle. Until then
 * `settings.theme` is the `system` default rather than the user's choice, and
 * `public/theme-init.js` has already painted the cached preference — writing the
 * default over it would flash a pinned-light user on a dark OS to dark and
 * straight back.
 */
export function ThemeProvider({ children }: ThemeProviderProps): ReactElement {
  const { settings, updateSettings, whenSettingsLoaded } = useSettings()
  const theme = settings.theme
  const accentColor = settings.accentColor
  const customAccentColor = settings.customAccentColor
  const liquidGlass = settings.liquidGlass
  const glassIntensity = settings.glassIntensity
  const uiRadius = settings.uiRadius
  const uiDensity = settings.uiDensity
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)
  const [loadOutcome, setLoadOutcome] = useState<SettingsLoadOutcome | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const outcome = await whenSettingsLoaded()
      if (active) {
        setLoadOutcome(outcome)
      }
    })()
    return () => {
      active = false
    }
  }, [whenSettingsLoaded])

  useEffect(() => {
    const media = window.matchMedia(DARK_MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme

  useEffect(() => {
    if (loadOutcome === null) {
      return
    }
    const root = document.documentElement
    const dark = isDarkResolvedTheme(resolvedTheme)
    root.classList.toggle('dark', dark)
    root.setAttribute('data-theme', resolvedTheme)
    root.setAttribute('data-accent', accentColor)
    // Liquid Glass restyles the active theme's surfaces (translucent, blurred
    // chrome over a tinted backdrop) — an orthogonal switch, not a theme. The
    // intensity rides along as its own attribute so the stylesheet can pick a
    // blur/tint pair without a rule per theme.
    if (liquidGlass) {
      root.setAttribute('data-glass', 'on')
      root.setAttribute('data-glass-level', glassIntensity)
    } else {
      root.removeAttribute('data-glass')
      root.removeAttribute('data-glass-level')
    }
    // The default radius is the design system's own geometry, so it declares
    // no scope — leaving the attribute off keeps the cascade one level shallower.
    if (uiRadius === 'default') {
      root.removeAttribute('data-radius')
    } else {
      root.setAttribute('data-radius', uiRadius)
    }
    // Density follows the radius pattern: one scope in the design system,
    // `default` declares nothing. The list virtualizer reads the same number
    // from `DENSITY_ROW_HEIGHT`, and a token test keeps CSS and JS equal.
    if (uiDensity === 'default') {
      root.removeAttribute('data-density')
    } else {
      root.setAttribute('data-density', uiDensity)
    }
    root.style.colorScheme = dark ? 'dark' : 'light'
    // Preset accents resolve through the design-system's `[data-accent]`
    // scopes; a custom hex has no scope, so its derived ramp is applied as
    // inline custom properties (which outrank every stylesheet scope) and
    // cleared the moment a preset takes over.
    if (accentColor === 'custom') {
      const tokens = deriveAccentTokens(customAccentColor, dark)
      root.style.setProperty('--accent', tokens.accent)
      root.style.setProperty('--accent-hover', tokens.accentHover)
      root.style.setProperty('--accent-soft', tokens.accentSoft)
      root.style.setProperty('--accent-soft-text', tokens.accentSoftText)
      root.style.setProperty('--focus-ring', tokens.focusRing)
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-hover')
      root.style.removeProperty('--accent-soft')
      root.style.removeProperty('--accent-soft-text')
      root.style.removeProperty('--focus-ring')
    }
  }, [
    loadOutcome,
    resolvedTheme,
    accentColor,
    customAccentColor,
    liquidGlass,
    glassIntensity,
    uiRadius,
    uiDensity,
  ])

  // Only a loaded document is worth caching: after a failed load changes apply
  // for the session only, so mirroring them would have the next launch paint a
  // preference that was never persisted. The last cached value stays instead.
  useEffect(() => {
    if (loadOutcome !== 'loaded') {
      return
    }
    writeCachedThemePreference(theme)
    writeCachedAccentColor(accentColor)
    writeCachedLiquidGlass(liquidGlass)
    writeCachedGlassIntensity(glassIntensity)
    writeCachedUiRadius(uiRadius)
    writeCachedUiDensity(uiDensity)
  }, [loadOutcome, theme, accentColor, liquidGlass, glassIntensity, uiRadius, uiDensity])

  const setTheme = useCallback((next: Theme) => updateSettings({ theme: next }), [updateSettings])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

/** Access the current theme and a setter. Must be used within a ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
