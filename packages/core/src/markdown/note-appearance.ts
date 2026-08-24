import { parseFrontmatter, splitFrontmatter } from './frontmatter'
import type { Frontmatter } from './model'
import { wikiEmbedKind } from './note-transclusion'

/**
 * Cover image and icon from note frontmatter (`cover:` / `icon:`). Markdown
 * stays the source of truth — these keys are reserved chrome, not tag
 * properties, and travel with the file.
 */

const WIKI_TARGET_RE = /^!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]]*)?\]\]$/
const HTTP_URL_RE = /^https?:\/\//i
const MAX_EMOJI_UNITS = 16

/** An emoji/short glyph, or a graph-relative (or https) image. */
export type NoteIcon =
  | { readonly kind: 'emoji'; readonly glyph: string }
  | { readonly kind: 'image'; readonly src: string }

/** Cover and icon parsed from a note's frontmatter. */
export interface NoteAppearance {
  readonly icon: NoteIcon | null
  readonly coverSrc: string | null
}

function unwrapTarget(raw: string): string {
  const trimmed = raw.trim()
  const wiki = WIKI_TARGET_RE.exec(trimmed)
  if (wiki?.[1] !== undefined) {
    return wiki[1].trim()
  }
  return trimmed
}

function isBlockedUrl(target: string): boolean {
  return target.includes('://') && !HTTP_URL_RE.test(target)
}

function isImageTarget(target: string): boolean {
  return HTTP_URL_RE.test(target) || wikiEmbedKind(target) === 'image'
}

/**
 * Parse `icon:` — a short glyph (`✨`) or an image path / `![[photo.png]]`.
 * Returns null for empty values, file paths that are not images, and
 * non-http(s) URLs.
 */
export function parseNoteIcon(value: unknown): NoteIcon | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  const target = unwrapTarget(trimmed)
  if (target === '' || isBlockedUrl(target)) {
    return null
  }
  if (isImageTarget(target)) {
    return { kind: 'image', src: target }
  }
  if (target.includes('/') || target.includes('\\') || target.includes('\n')) {
    return null
  }
  if ([...target].length > MAX_EMOJI_UNITS) {
    return null
  }
  return { kind: 'emoji', glyph: target }
}

/**
 * Parse `cover:` — a graph-relative image path, wiki embed, or http(s) URL.
 * Non-image targets and non-http(s) URLs are ignored.
 */
export function parseNoteCover(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const target = unwrapTarget(value)
  if (target === '' || isBlockedUrl(target) || !isImageTarget(target)) {
    return null
  }
  return target
}

/** Read {@link NoteAppearance} from already-parsed frontmatter. */
export function parseNoteAppearance(frontmatter: Frontmatter): NoteAppearance {
  return {
    icon: parseNoteIcon(frontmatter.icon),
    coverSrc: parseNoteCover(frontmatter.cover),
  }
}

/**
 * Read {@link NoteAppearance} from a note's source (or the exact frontmatter
 * header bytes the editor session keeps). Body-only markdown yields nothing.
 */
export function parseNoteAppearanceFromSource(source: string): NoteAppearance {
  const { data } = parseFrontmatter(splitFrontmatter(source).raw)
  return parseNoteAppearance(data)
}
