import { isAttachmentPath } from '../graph/paths'
import { parseNote } from './extract'
import { foldKey } from './keys'
import { splitFrontmatter } from './frontmatter'
import { sectionEnd, topLevelHeadings } from './heading-blocks'

/**
 * Note transclusion (`![[Note]]` / `![[Note#Heading]]`): portable wiki embeds
 * whose target is another note. Attachment embeds (`![[photo.png]]`) stay
 * images/files; this parser only yields note bodies the host can render live.
 */

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
])

/** One `![[target]]` (optionally `#heading` and `|alias`) in a note body. */
export interface NoteTransclusion {
  /** Wiki target, heading fragment stripped. */
  readonly target: string
  /** Heading text or slug after `#`, or null for the whole note. */
  readonly heading: string | null
}

const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g

/** How a wiki-embed target should render in meowdown. */
export type WikiEmbedKind = 'image' | 'file' | 'note'

function extensionOf(target: string): string {
  const file = (target.split('#')[0] ?? target).split('/').at(-1) ?? target
  const dot = file.lastIndexOf('.')
  if (dot <= 0 || dot === file.length - 1) {
    return ''
  }
  return file.slice(dot + 1).toLowerCase()
}

function fileOf(target: string): string {
  return target.split('#')[0] ?? target
}

/**
 * Classify `![[target]]` for meowdown's wiki-embed resolver. Images and other
 * attachments render in-editor; notes stay literals so the host can transclude
 * their body underneath the editor.
 */
export function wikiEmbedKind(target: string): WikiEmbedKind {
  const file = fileOf(target).trim()
  const basename = file.split('/').at(-1) ?? file
  if (IMAGE_EXTENSIONS.has(extensionOf(file))) {
    return 'image'
  }
  if (isAttachmentPath(file) || isAttachmentPath(basename)) {
    return 'file'
  }
  return 'note'
}

function withoutCode(markdown: string): string {
  return markdown.replaceAll(/```[\s\S]*?```/g, '').replaceAll(/`[^`]*`/g, '')
}

function parseEmbedInner(inner: string): NoteTransclusion | null {
  const unaliased = (inner.split('|')[0] ?? inner).trim()
  if (unaliased === '') {
    return null
  }
  const hash = unaliased.indexOf('#')
  const target = (hash === -1 ? unaliased : unaliased.slice(0, hash)).trim()
  const heading = hash === -1 ? null : unaliased.slice(hash + 1).trim()
  if (target === '' || wikiEmbedKind(target) !== 'note') {
    return null
  }
  return { target, heading: heading === '' ? null : heading }
}

/**
 * Every note-bodied `![[…]]` embed in `markdown`, in source order. Attachment
 * embeds and fenced/inline code are skipped.
 */
export function parseNoteTransclusions(markdown: string): NoteTransclusion[] {
  const embeds: NoteTransclusion[] = []
  for (const match of withoutCode(markdown).matchAll(EMBED_RE)) {
    const parsed = parseEmbedInner(match[1] ?? '')
    if (parsed !== null) {
      embeds.push(parsed)
    }
  }
  return embeds
}

/** The markdown inserted for one transclusion. */
export function formatNoteTransclusion(embed: NoteTransclusion): string {
  const heading = embed.heading === null ? '' : `#${embed.heading}`
  return `![[${embed.target}${heading}]]`
}

function headingMatches(heading: { text: string; slug: string }, query: string): boolean {
  const folded = foldKey(query)
  return foldKey(heading.text) === folded || heading.slug === query || heading.slug === folded
}

/**
 * The markdown of one top-level heading section (the heading line through the
 * next same-or-higher heading), or null when `heading` is not in the note.
 */
export function extractHeadingSection(source: string, heading: string): string | null {
  const parsed = parseNote({ path: 'notes/transclusion.md', source })
  const headings = topLevelHeadings(parsed.headings)
  const target = headings.find((entry) => headingMatches(entry, heading))
  if (target === undefined) {
    return null
  }
  const slice = source.slice(target.from, sectionEnd(headings, target, source.length)).trim()
  return slice === '' ? null : slice
}

/** Body markdown for a transclusion: a heading section, or the whole body. */
export function transclusionMarkdown(source: string, heading: string | null): string | null {
  if (heading === null) {
    const body = splitFrontmatter(source).body.trim()
    return body === '' ? '' : body
  }
  return extractHeadingSection(source, heading)
}
