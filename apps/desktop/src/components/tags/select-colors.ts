/**
 * Deterministic categorical colors for select options (TDR 0005): every
 * surface that shows an option (table badge, board lane dot) hashes the
 * option text into one fixed palette, so "reading" is the same hue in every
 * view and on every device with zero configuration — and a renamed option
 * simply reads as a new category. Explicit per-option colors can layer on
 * top later; the hash stays the fallback.
 */

/** Badge classes per palette slot (background wash + readable text). */
const BADGE_CLASSES = [
  'bg-red-500/15 text-red-700 dark:text-red-300',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-green-500/15 text-green-700 dark:text-green-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-pink-500/15 text-pink-700 dark:text-pink-300',
] as const

/** Solid dot classes per palette slot (the board lane marker). */
const DOT_CLASSES = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-green-500',
  'bg-teal-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-pink-500',
] as const

/** djb2 over the option text — stable across sessions and platforms. */
function paletteSlot(option: string): number {
  let hash = 5381
  for (let index = 0; index < option.length; index += 1) {
    hash = (hash * 33) ^ option.charCodeAt(index)
  }
  return Math.abs(hash) % BADGE_CLASSES.length
}

/** The badge (wash + text) classes for an option value. */
export function selectOptionBadgeClass(option: string): string {
  return BADGE_CLASSES[paletteSlot(option)] as string
}

/** The solid dot class for an option value (board lane headers). */
export function selectOptionDotClass(option: string): string {
  return DOT_CLASSES[paletteSlot(option)] as string
}
