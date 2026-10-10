/**
 * JSON Canvas colors: presets `"1"`–`"6"` (red, orange, yellow, green,
 * cyan, purple, which the app picks hues for) or any hex color. Fixed
 * mid-range hues, like the graph colors, so they read on both themes.
 */
const PRESETS: Record<string, string> = {
  '1': '#ef4444',
  '2': '#f97316',
  '3': '#eab308',
  '4': '#22c55e',
  '5': '#06b6d4',
  '6': '#a855f7',
}

/** The CSS color for a canvas color, or null for unset or unreadable. */
export function canvasColor(color: string | null): string | null {
  if (color === null) {
    return null
  }
  const preset = PRESETS[color.trim()]
  if (preset !== undefined) {
    return preset
  }
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color.trim())
    ? color.trim()
    : null
}
