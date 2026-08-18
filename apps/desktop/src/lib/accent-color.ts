/**
 * Derivations for the custom accent color (Settings → Appearance → Custom).
 * The preset accents carry hand-tuned ramps in the design-system tokens; a
 * user-picked hex has to derive its hover/soft/soft-text companions, which
 * the ThemeProvider applies as inline custom properties on the root.
 */

interface Rgb {
  red: number
  green: number
  blue: number
}

function hexToRgb(hex: string): Rgb {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  }
}

function channel(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0')
}

/** Mix `hex` toward `target` by `amount` (0–1) in sRGB. */
export function mixHex(hex: string, target: string, amount: number): string {
  const from = hexToRgb(hex)
  const to = hexToRgb(target)
  return `#${channel(from.red + (to.red - from.red) * amount)}${channel(
    from.green + (to.green - from.green) * amount,
  )}${channel(from.blue + (to.blue - from.blue) * amount)}`
}

/** `hex` as an rgba() with the given alpha. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const { red, green, blue } = hexToRgb(hex)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/** The accent token set derived from one hex, per theme family. */
export interface AccentTokens {
  accent: string
  accentHover: string
  accentSoft: string
  accentSoftText: string
  focusRing: string
}

/**
 * Derive the full accent token set from a hex color. Mirrors the shape of
 * the hand-tuned preset ramps: hover lightens, soft is a translucent wash
 * (stronger in dark), and soft-text darkens on light surfaces / lightens on
 * dark ones so it stays readable over the soft wash.
 */
export function deriveAccentTokens(hex: string, dark: boolean): AccentTokens {
  return {
    accent: hex,
    accentHover: mixHex(hex, '#ffffff', 0.18),
    accentSoft: hexWithAlpha(hex, dark ? 0.28 : 0.16),
    accentSoftText: dark ? mixHex(hex, '#ffffff', 0.55) : mixHex(hex, '#000000', 0.3),
    focusRing: hex,
  }
}
