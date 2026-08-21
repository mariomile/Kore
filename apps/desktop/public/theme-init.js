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
// unreadable cache all fall back to the OS preference. The accent color is
// mirrored the same way; its absence just paints the default (indigo) accent.
// ThemeProvider re-applies the real values once settings load.
{
  // Keep in sync with THEME_PREFERENCE_CACHE_KEY in src/lib/theme-cache.ts.
  const PREFERENCE_KEY = 'reflect.theme.preference'
  // Keep in sync with THEME_ACCENT_CACHE_KEY in src/lib/theme-cache.ts.
  const ACCENT_KEY = 'reflect.theme.accent'
  // Keep in sync with THEME_GLASS_CACHE_KEY in src/lib/theme-cache.ts.
  const GLASS_KEY = 'reflect.theme.glass'

  // Keep in sync with themePreferenceSchema / accentColorSchema in
  // packages/core/src/settings/schema.ts and with isDarkResolvedTheme in
  // src/providers/theme-provider.tsx.
  const PINNED_THEMES = ['light', 'dark', 'space', 'midnight', 'paper']
  const DARK_THEMES = ['dark', 'space', 'midnight']
  const ACCENTS = ['indigo', 'purple', 'blue', 'teal', 'green', 'amber', 'rose', 'red']

  function pinnedTheme() {
    try {
      const preference = localStorage.getItem(PREFERENCE_KEY)
      return PINNED_THEMES.includes(preference) ? preference : null
    } catch {
      return null
    }
  }

  function cachedAccent() {
    try {
      const accent = localStorage.getItem(ACCENT_KEY)
      return ACCENTS.includes(accent) ? accent : null
    } catch {
      return null
    }
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = pinnedTheme() ?? (prefersDark ? 'dark' : 'light')
  const dark = DARK_THEMES.includes(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  const accent = cachedAccent()
  if (accent) {
    document.documentElement.setAttribute('data-accent', accent)
  }
  try {
    if (localStorage.getItem(GLASS_KEY) === 'on') {
      document.documentElement.setAttribute('data-glass', 'on')
    }
  } catch {
    // Storage unavailable; the first frame paints without glass.
  }
}
