import type { Span } from './model'

/**
 * Preview text (list rows and cards): what a note says, as clean plain text.
 * Three kinds of source never read as a sentence, and each gets its own
 * treatment on top of the ordinary plain-text cuts:
 *
 * - **Noise** is always dropped: code, comments, embeds, footnotes, HTML, and
 *   Obsidian plugin leftovers (a ```dataview query, a Templater
 *   `<% tp.file.title %>`, a `%% comment %%`).
 * - **Tables** are rewritten, never shown raw: `Stage: Seed · Founded: 2021`
 *   instead of `| Stage | Seed | | --- |`.
 * - **Scaffolding** (headings, tag lines, `Type: #meeting`) is dropped while
 *   the note has prose to show, and kept when it is all the note has, so a
 *   card is empty only when the note is.
 *
 * The search text is untouched: all of it stays searchable.
 */

/** Nodes whose whole range is noise. */
const NOISE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'BlockMath',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'Comment',
  'ProcessingInstruction',
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
/** A property's name: one or two words (`Type`, `Due date`). Longer is a sentence. */
const LABEL = String.raw`\p{L}[\p{L}\p{N}_-]*(?: [\p{L}\p{N}_-]+)?`
/** Where a line's own text starts: after indentation, quote marks, a list marker. */
const LINE_LEAD = String.raw`^[ \t]*(?:>[ \t]*)*(?:[-*+][ \t]+)?`
/**
 * A scaffolding line: tags alone (`#meeting #work`, the line that gives a
 * note its type), or a label holding only tags or bare URLs (`Type: #meeting`,
 * `URL: https://…`; the URL itself never shows, so the label would dangle).
 * A label with words or a link is content and stays: `Role: CEO`,
 * `Author: [[James Clear]]`, and so does a sentence that merely ends like one.
 */
const SCAFFOLDING_LINE = new RegExp(
  String.raw`${LINE_LEAD}(?:${LABEL}:[ \t]*)?(?:(?:${TAG}|<?https?:\/\/\S+)[ \t,]*)+$`,
  'gmu',
)
/** A Dataview field's second colon: `status:: active` reads `status: active`. */
const DATAVIEW_FIELD_COLON = new RegExp(String.raw`${LINE_LEAD}${LABEL}:(:)(?=[ \t])`, 'gmu')

/** A line break written as HTML: `<br>`, `<br/>`, `<BR >`. */
const HTML_LINE_BREAK = /^<br\b/i

/**
 * Does cutting this noise node part two words? Only a `<br>` does: `<b>` and
 * its kin wrap words (`<b>bold</b>ly` reads `boldly`), a break separates them.
 */
export function isPreviewWordBreak(name: string, text: string): boolean {
  return name === 'HTMLTag' && HTML_LINE_BREAK.test(text)
}

/** Is the tree node `name`, whose source is `text`, preview noise as a whole? */
export function isPreviewNoiseNode(name: string, text: string): boolean {
  if (NOISE_NODES.has(name)) {
    return true
  }
  return name === 'InlineCode' && DATAVIEW_INLINE.test(text)
}

/** The preview spans the markdown tree has no node for. */
export interface PreviewSpans {
  /**
   * Always dropped: Templater tags, Obsidian `%%` comments, footnotes, a
   * Dataview field's second colon, and callout `[!type]` markers (the
   * callout's title and body stay; they are the note's words).
   */
  noise: Span[]
  /** Dropped while the note has prose: tag lines and `Type: #meeting` lines. */
  scaffolding: Span[]
}

function matchSpans(text: string, pattern: RegExp): Span[] {
  return Array.from(text.matchAll(pattern), (match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }))
}

/** The last capture group's span: the tail of each match of `pattern`. */
function matchTailSpans(text: string, pattern: RegExp): Span[] {
  return Array.from(text.matchAll(pattern), (match) => {
    const to = match.index + match[0].length
    return { from: to - (match[1]?.length ?? 0), to }
  })
}

/**
 * Scan `body` for {@link PreviewSpans}. `codeRanges` are blanked before the
 * scan, so a `%%` line inside a Mermaid fence can't pair with a later one and
 * swallow the prose between them.
 */
export function previewSpans(body: string, codeRanges: readonly Span[]): PreviewSpans {
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
  return {
    noise: [
      ...matchSpans(scanned, TEMPLATER_TAG),
      ...matchSpans(scanned, OBSIDIAN_COMMENT),
      ...matchSpans(scanned, FOOTNOTE),
      ...matchTailSpans(scanned, CALLOUT_MARKER),
      ...matchTailSpans(scanned, DATAVIEW_FIELD_COLON),
    ],
    scaffolding: matchSpans(scanned, SCAFFOLDING_LINE),
  }
}
