import type { Span } from './model'

/**
 * Preview noise (list-row snippets): source a reader never sees as prose, cut
 * from the preview text on top of the ordinary plain-text cuts. Notes imported
 * from Obsidian open with plugin leftovers (a ```dataview query, a Templater
 * `<% tp.file.title %>`, a `%% comment %%`), and the plain text keeps all of it
 * verbatim, so a row's snippet read as query code instead of the note. The
 * search text is untouched: code stays searchable, only the preview skips it.
 */

/** Block nodes whose whole range is never preview prose. */
const NOISE_BLOCKS = new Set([
  'FencedCode',
  'CodeBlock',
  'BlockMath',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'Comment',
  'ProcessingInstruction',
])

/** Dataview inline queries: `` `= this.status` `` and `` `$= dv.current()` ``. */
const DATAVIEW_INLINE = /^`+\s*\$?=/

/** Templater tags, any form: `<% … %>`, `<%* … %>`, `<%- … -%>`. */
const TEMPLATER_TAG = /<%[\s\S]*?%>/g
/** Obsidian comments: `%% … %%`, inline or across lines. */
const OBSIDIAN_COMMENT = /%%[\s\S]*?%%/g
/** A callout's type marker after its quote marks: `> [!note]`, `> [!faq]-`. */
const CALLOUT_MARKER = /^(?:[ \t]*>[ \t]?)+(\[![^\]\n]+\][+-]?)/gm

/** Is the tree node `name`, whose source is `text`, preview noise as a whole? */
export function isPreviewNoiseNode(name: string, text: string): boolean {
  if (NOISE_BLOCKS.has(name)) {
    return true
  }
  return name === 'InlineCode' && DATAVIEW_INLINE.test(text)
}

/**
 * Body spans of the noise the markdown tree has no node for: Templater tags,
 * Obsidian `%%` comments, and callout `[!type]` markers (the callout's title
 * and body stay; they are the note's words). `codeRanges` are blanked before
 * the scan, so a `%%` line inside a Mermaid fence can't pair with a later one
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
  for (const pattern of [TEMPLATER_TAG, OBSIDIAN_COMMENT]) {
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
