/**
 * Line-level context extraction for the backlinks panel (Plan 07): given a
 * note's source and a link's whole-file offset (the index stores `pos_from`
 * with the frontmatter offset already applied), return the surrounding line,
 * trimmed around the position when the line runs long.
 */

const DEFAULT_MAX_LENGTH = 160
const PREVIEW_MAX_LENGTH = 120

/**
 * `text.slice(0, maxLength)` that never ends on a lone UTF-16 high surrogate.
 * A raw code-unit slice can cut an astral character — an emoji, or the
 * mathematical-alphanumeric letters people paste from Twitter — in half,
 * leaving a dangling high surrogate. That half-character survives `JSON.stringify`
 * as a lone `\udXXX`, which the Rust index writer's serde_json rejects with
 * "unexpected end of hex escape", and the whole note is dropped from the rebuilt
 * index. Trimming the orphaned surrogate keeps the slice a single code unit
 * shorter and always well-formed.
 */
function sliceWithoutSplittingSurrogate(text: string, maxLength: number): string {
  const end = Math.min(maxLength, text.length)
  const lastCode = text.charCodeAt(end - 1)
  const isLoneHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff
  return text.slice(0, isLoneHighSurrogate ? end - 1 : end)
}

/** The raw line of `content` containing `pos`, with that line's start offset. */
function rawLineAt(content: string, pos: number): { lineStart: number; rawLine: string } {
  const at = Math.max(0, Math.min(pos, content.length))
  const lineStart = content.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  const lineEndRaw = content.indexOf('\n', at)
  const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw
  return { lineStart, rawLine: content.slice(lineStart, lineEnd) }
}

/**
 * The whole trimmed line of `content` containing `pos`, never windowed. The
 * backlinks panel renders this through meowdown, which needs balanced Markdown;
 * windowing (see `lineSnippet`) can cut a `[[wiki link]]` or `**bold**` token in
 * half. The line is bounded by `\n`, so a renderer clamps it visually instead.
 */
export function lineAt(content: string, pos: number): string {
  return rawLineAt(content, pos).rawLine.trim()
}

/** The single line of `content` containing `pos`, windowed to `maxLength`. */
export function lineSnippet(content: string, pos: number, maxLength = DEFAULT_MAX_LENGTH): string {
  const { lineStart, rawLine } = rawLineAt(content, pos)
  const line = rawLine.trim()
  if (line.length <= maxLength) {
    return line
  }
  // Window around the link's position within the *trimmed* line: the trim
  // shifted offsets by the leading whitespace, and on a long indented line an
  // unadjusted position could window the link right out of the snippet.
  const at = Math.max(0, Math.min(pos, content.length))
  const startTrim = rawLine.length - rawLine.trimStart().length
  const posInLine = Math.max(0, Math.min(at - lineStart - startTrim, line.length))
  const half = Math.floor(maxLength / 2)
  const from = Math.max(0, Math.min(posInLine - half, line.length - maxLength))
  const to = from + maxLength
  const prefix = from > 0 ? '…' : ''
  const suffix = to < line.length ? '…' : ''
  return `${prefix}${line.slice(from, to).trim()}${suffix}`
}

/**
 * A list-row preview of a note from its preview text (`ParsedNote.previewText`:
 * prose only, no headings or other structure, so the note's own title never
 * leads it). Whitespace is collapsed first, so the function is total over both
 * the stored text and any fresher multi-line source; long text is cut at
 * `maxLength` with an ellipsis.
 */
export function previewSnippet(text: string, maxLength = PREVIEW_MAX_LENGTH): string {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${sliceWithoutSplittingSurrogate(collapsed, maxLength).trimEnd()}…`
}
