import { OPTION_COLORS, optionColorOf, type OptionColor, type TagProperty } from '@kore/core'

/**
 * Categorical colors for select options (TDR 0005). An option the type's
 * definition paints (`colors: { Done: green }`) uses that palette color; any
 * other option hashes its text into the same palette, so "reading" is the
 * same hue in every view and on every device with zero configuration.
 * Every surface that shows an option (table badge, card chip, board lane
 * dot, the options editor) goes through here, so a color picked in the
 * type's settings lands everywhere at once.
 */

/** Badge classes per palette color (background wash + readable text). */
const BADGE_CLASSES: Record<OptionColor, string> = {
  gray: 'bg-neutral-500/15 text-neutral-700 dark:text-neutral-300',
  brown: 'bg-stone-500/20 text-stone-700 dark:text-stone-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  green: 'bg-green-500/15 text-green-700 dark:text-green-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  pink: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
}

/** Solid dot classes per palette color (board lane marker, swatches). */
const DOT_CLASSES: Record<OptionColor, string> = {
  gray: 'bg-neutral-400',
  brown: 'bg-stone-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
}

/** Display names for the palette, in picker order. */
export const OPTION_COLOR_LABELS: Record<OptionColor, string> = {
  gray: 'Gray',
  brown: 'Brown',
  red: 'Red',
  orange: 'Orange',
  amber: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  violet: 'Purple',
  pink: 'Pink',
}

/** The colors the hash spreads over: the vivid ones, never gray or brown,
 * so an unpainted option keeps the look it had before colors existed. */
const HASHED: readonly OptionColor[] = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
]

/** djb2 over the option text: stable across sessions and platforms. */
export function hashedOptionColor(option: string): OptionColor {
  let hash = 5381
  for (let index = 0; index < option.length; index += 1) {
    hash = (hash * 33) ^ option.charCodeAt(index)
  }
  return HASHED[Math.abs(hash) % HASHED.length] as OptionColor
}

/** The color `option` shows with: the definition's pick, else the hash. */
export function resolvedOptionColor(
  option: string,
  property?: Pick<TagProperty, 'colors'>,
): OptionColor {
  return optionColorOf(property, option) ?? hashedOptionColor(option)
}

/** Badge classes for a palette color. */
export function optionColorBadgeClass(color: OptionColor): string {
  return BADGE_CLASSES[color]
}

/** Dot classes for a palette color. */
export function optionColorDotClass(color: OptionColor): string {
  return DOT_CLASSES[color]
}

/** The badge (wash + text) classes for an option value. */
export function selectOptionBadgeClass(
  option: string,
  property?: Pick<TagProperty, 'colors'>,
): string {
  return BADGE_CLASSES[resolvedOptionColor(option, property)]
}

/** The solid dot class for an option value (board lane headers). */
export function selectOptionDotClass(
  option: string,
  property?: Pick<TagProperty, 'colors'>,
): string {
  return DOT_CLASSES[resolvedOptionColor(option, property)]
}

export { OPTION_COLORS }
