import { parseNoteIcon, symbolIconValue } from '../markdown/note-appearance'
import { TAG_SYMBOL_CATALOG } from './tag-symbol-catalog.gen'

export { TAG_SYMBOL_CATALOG }

/**
 * One symbol icon a tag can store as `icon:<name>`: the stored name and a
 * short hint (its theme group, plus the Solar glyph's own words when they
 * add something) so a model can pick by meaning without seeing the glyph.
 */
export interface TagSymbolIconEntry {
  readonly name: string
  readonly hint: string
}

const SYMBOL_NAMES: ReadonlySet<string> = new Set(TAG_SYMBOL_CATALOG.map((entry) => entry.name))

/** Whether `name` is a symbol icon this build renders. */
export function isTagSymbolIconName(name: string): boolean {
  return SYMBOL_NAMES.has(name)
}

/** Refusals, read verbatim by the model and shown in the chip. */
export const UNKNOWN_TAG_ICON_ERROR =
  'Not an icon in this app — call list_tag_icons and pick one of its names, or pass a single emoji.'

export type TagIconResolution = { ok: true; icon: string } | { ok: false; error: string }

const EMOJI_RE = /\p{Extended_Pictographic}/u

/** Whether `text` is exactly one emoji grapheme (the icon picker's own rule). */
function isSingleEmoji(text: string): boolean {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
  return graphemes.length === 1 && EMOJI_RE.test(text)
}

/**
 * Turn what a model wrote into the stored `icon:` value: a catalog name
 * (`building`, or already `icon:building`) becomes `icon:<name>`, one emoji
 * stays itself, anything else — an unknown name, an image, a word — refuses
 * with the catalog as the way out. The stored form is the only thing that
 * ever reaches a definition note, so an icon the app cannot draw is never
 * written.
 */
export function resolveTagIconInput(input: string): TagIconResolution {
  const trimmed = input.trim()
  const bare = trimmed.startsWith('icon:') ? trimmed.slice('icon:'.length) : trimmed
  if (isTagSymbolIconName(bare)) {
    return { ok: true, icon: symbolIconValue(bare) }
  }
  const parsed = parseNoteIcon(trimmed)
  if (parsed?.kind === 'emoji' && isSingleEmoji(parsed.glyph)) {
    return { ok: true, icon: parsed.glyph }
  }
  return { ok: false, error: UNKNOWN_TAG_ICON_ERROR }
}
