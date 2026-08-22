// Apply the theme before the design-system CSS does, so the first painted
// frame is already the theme the user will end up on — otherwise a dark-mode
// user sees a light-to-dark flash between that paint and the ThemeProvider
// mounting. Kept as an external file because the app CSP is
// `script-src 'self'`: inline scripts would be blocked.
//
// The persisted preference lives in the settings document, which only arrives
// over IPC after the first paint, so `ThemeProvider`
// (`src/providers/theme-provider.tsx`) mirrors it into localStorage for the
// next launch. A pinned theme wins here; `system`, a first launch, and an
// unreadable cache all fall back to the OS preference. The accent color, the
// corner radius and the Liquid Glass switch are mirrored the same way; each
// absent value just paints its default. ThemeProvider re-applies the real
// values once settings load.
{
  // Keep in sync with THEME_PREFERENCE_CACHE_KEY in src/lib/theme-cache.ts.
  const PREFERENCE_KEY = 'reflect.theme.preference'
  // Keep in sync with THEME_ACCENT_CACHE_KEY in src/lib/theme-cache.ts.
  const ACCENT_KEY = 'reflect.theme.accent'
  // Keep in sync with THEME_GLASS_CACHE_KEY in src/lib/theme-cache.ts.
  const GLASS_KEY = 'reflect.theme.glass'
  // Keep in sync with THEME_GLASS_LEVEL_CACHE_KEY in src/lib/theme-cache.ts.
  const GLASS_LEVEL_KEY = 'reflect.theme.glass-level'
  // Keep in sync with THEME_RADIUS_CACHE_KEY in src/lib/theme-cache.ts.
  const RADIUS_KEY = 'reflect.theme.radius'

  // Keep in sync with themePreferenceSchema / DARK_THEME_IDS /
  // accentColorSchema / uiRadiusSchema / glassIntensitySchema in
  // packages/core/src/settings/schema.ts.
  const PINNED_THEMES = ['light', 'ash', 'paper', 'dark', 'graphite', 'space', 'midnight']
  const DARK_THEMES = ['dark', 'graphite', 'space', 'midnight']
  const ACCENTS = [
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
  ]
  // `default` is the design system's own geometry and declares no scope, so it
  // is deliberately absent: an unset attribute *is* the default.
  const RADII = ['sharp', 'small', 'round']
  const GLASS_LEVELS = ['subtle', 'regular', 'strong']

  function cached(key, allowed) {
    try {
      const value = localStorage.getItem(key)
      return allowed.includes(value) ? value : null
    } catch {
      return null
    }
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = cached(PREFERENCE_KEY, PINNED_THEMES) ?? (prefersDark ? 'dark' : 'light')
  const dark = DARK_THEMES.includes(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  const accent = cached(ACCENT_KEY, ACCENTS)
  if (accent) {
    document.documentElement.setAttribute('data-accent', accent)
  }
  const radius = cached(RADIUS_KEY, RADII)
  if (radius) {
    document.documentElement.setAttribute('data-radius', radius)
  }
  if (cached(GLASS_KEY, ['on', 'off']) === 'on') {
    document.documentElement.setAttribute('data-glass', 'on')
    document.documentElement.setAttribute(
      'data-glass-level',
      cached(GLASS_LEVEL_KEY, GLASS_LEVELS) ?? 'regular',
    )
  }
}
