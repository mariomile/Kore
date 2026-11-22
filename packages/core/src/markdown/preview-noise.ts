import type { Span } from './model'

/**
 * Preview noise (list-row snippets): source a reader never sees as prose, cut
 * from the preview text on top of the ordinary plain-text cuts. A preview is
 * the note's own sentences and list items, nothing else: a card that reads
 * `Info | Campo | Valore | | --- |` or `Type: #meeting` shows the note's
 * scaffolding, not the note. So structure goes (headings, tables, property
 * lines, embeds, footnotes, HTML), and so do Obsidian plugin leftovers (a
 * ```dataview query, a Templater `<% tp.file.title %>`, a `%% comment %%`).
 * A note with no prose previews as nothing. The search text is untouched:
 * all of it stays searchable, only the preview skips it.
 */

/**
 * Nodes whose whole range is never preview prose. Headings are noise too
 * (section labels, not sentences); the note walk already identifies them by
 * node id and cuts them there.
 */
const NOISE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'BlockMath',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'Comment',
  'ProcessingInstruction',
  // Structure: a table's cells mean nothing without their grid.
  'Table',
  // `![alt](src)`, `![[file or note]]`: the reader sees the embed, not its name.
  'Image',
  'WikiEmbed',
  // `<b>`, `<br>`: the tag goes, the words it wraps stay.
  'HTMLTag',
  // `[^1]: …` and `[ref]: url` definitions.
  'LinkReference',
])

/** Dataview inline queries: `` `= this.status` `` and `` `$= dv.current()` ``. */
const DATAVIEW_INLINE = /^`+\s*\$?=/

/** Templater tags, any form: `<% … %>`, `<%* … %>`, `<%- … -%>`. */
const TEMPLATER_TAG = /<%[\s\S]*?%>/g
/** Obsidian comments: `%% … %%`, inline or across lines. */
const OBSIDIAN_COMMENT = /%%[\s\S]*?%%/g
/** A callout's type marker after its quote marks: `> [!note]`, `> [!faq]-`. */
const CALLOUT_MARKER = /^(?:[ \t]*>)+[ \t]*(\[![^\]\n]+\][+-]?)/gm
/** A footnote: its whole `[^1]: …` definition line, or a `[^1]` reference. */
const FOOTNOTE = /^[ \t]*\[\^[^\]\s]+\]:.*$|\[\^[^\]\s]+\]/gm
const TAG = String.raw`#[^\s#]+`
/** What a property holds instead of words: a tag, a wiki or Markdown link, a bare URL. */
const REFERENCE = String.raw`(?:${TAG}|\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\)|<?https?:\/\/\S+)`
/** A property's name: one or two words (`Type`, `Due date`). Longer is a sentence. */
const LABEL = String.raw`\p{L}[\p{L}\p{N}_-]*(?: [\p{L}\p{N}_-]+)?`
/**
 * A property line, after an optional list marker: tags alone (`#meeting
 * #work`, the line that gives a note its type), a label holding only
 * references (`Type: #meeting`, `Author: [[James Clear]]`, `URL: https://…`),
 * or a Dataview field (`status:: active`). Metadata the app shows as fields,
 * never a sentence: `Decision: ship it on Monday` has words and stays, and so
 * does `We met for the first time: [[Sarah Chen]]`, whose lead is no label.
 */
const PROPERTY_LINE = new RegExp(
  String.raw`^[ \t]*(?:[-*+][ \t]+)?(?:(?:${TAG}[ \t]*)+|${LABEL}:[ \t]*(?:${REFERENCE}[ \t,]*)+|${LABEL}::[ \t].*)$`,
  'gmu',
)

/** Is the tree node `name`, whose source is `text`, preview noise as a whole? */
export function isPreviewNoiseNode(name: string, text: string): boolean {
  if (NOISE_NODES.has(name)) {
    return true
  }
  return name === 'InlineCode' && DATAVIEW_INLINE.test(text)
}

/**
 * Body spans of the noise the markdown tree has no node for: Templater tags,
 * Obsidian `%%` comments, footnotes, property lines, and callout `[!type]`
 * markers (the callout's title and body stay; they are the note's words).
 * `codeRanges` are blanked before the scan, so a `%%` line inside a Mermaid fence can't pair with a later one
 * and swallow the prose between them.
 */
export function previewNoiseSpans(body: string, codeRanges: readonly Span[]): Span[] {
  let scanned = ''
  let cursor = 0
  for (const range of [...codeRanges].sort((a, b) => a.from - b.from)) {
    if (range.to <= cursor) {
      continue
    }
    const from = Math.max(cursor, range.from)
    scanned += body.slice(cursor, from) + ' '.repeat(range.to - from)
    cursor = range.to
  }
  scanned += body.slice(cursor)
  const spans: Span[] = []
  for (const pattern of [TEMPLATER_TAG, OBSIDIAN_COMMENT, FOOTNOTE, PROPERTY_LINE]) {
    for (const match of scanned.matchAll(pattern)) {
      spans.push({ from: match.index, to: match.index + match[0].length })
    }
  }
  for (const match of scanned.matchAll(CALLOUT_MARKER)) {
    const marker = match[1] ?? ''
    const to = match.index + match[0].length
    spans.push({ from: to - marker.length, to })
  }
  return spans
}
