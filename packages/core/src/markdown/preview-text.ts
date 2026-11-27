import type { SyntaxNode } from '@meowdown/markdown'
import type { Span } from './model'
import {
  buildPlainText,
  plainTextOfRange,
  plainTextSpans,
  type Cut,
  type PlainTextSpans,
} from './plain-text'
import type { PreviewSpans } from './preview-noise'

/**
 * Assembles a note's preview text (see `preview-noise.ts` for what counts as
 * noise, a table, and scaffolding) from the spans the note walk collected.
 */

/** Separates a table's rows in its one-line rendering. */
const ROW_SEPARATOR = ' · '

/**
 * A table as one line of plain text, from its rows' cell texts (header row
 * first). A two-column table is a list of fields: each row reads `name:
 * value`, the header (`Field | Value`) says nothing and goes, and so does a
 * row left blank. Any other table keeps every row, cells comma-separated.
 * Empty when no cell has anything to say (a template nobody filled in).
 */
export function tablePreviewText(rows: readonly (readonly string[])[]): string {
  const isFieldList = rows[0]?.length === 2
  const lines = isFieldList
    ? rows.slice(1).flatMap(([name = '', value = '']) => {
        return name === '' || value === '' ? [] : [`${name}: ${value}`]
      })
    : rows.map((row) => row.filter((cell) => cell !== '').join(', ')).filter((line) => line !== '')
  return lines.join(ROW_SEPARATOR)
}

/**
 * A table node's rows as cell texts, header row first. A blank cell has no
 * node of its own in the tree, so cells are counted off the pipes around
 * them: every pipe but a row's leading one closes a cell.
 */
function tableRows(body: string, table: SyntaxNode, spans: PlainTextSpans): string[][] {
  const rows: string[][] = []
  for (let row = table.firstChild; row !== null; row = row.nextSibling) {
    if (row.name !== 'TableHeader' && row.name !== 'TableRow') {
      continue
    }
    const cells: string[] = []
    let cell: string | null = null
    for (let child = row.firstChild; child !== null; child = child.nextSibling) {
      if (child.name === 'TableCell') {
        cell = plainTextOfRange(body, child.from, child.to, spans)
      } else if (child.name === 'TableDelimiter') {
        if (child.prevSibling !== null) {
          cells.push(cell ?? '')
        }
        cell = null
      }
    }
    if (cell !== null) {
      cells.push(cell)
    }
    rows.push(cells)
  }
  return rows
}

/** What the note walk hands over, all in body coordinates. */
export interface PreviewParts {
  /** The ordinary plain-text cuts plus the noise nodes. */
  noise: readonly Cut[]
  /** Section headings (H2 and deeper): scaffolding the tree knows by node. */
  headings: readonly Span[]
  tables: readonly SyntaxNode[]
  /** The spans the tree has no node for. */
  spans: PreviewSpans
  literalRanges: Span[]
}

/**
 * The note's preview text: its prose, with tables rewritten as one line. When
 * the note has no prose, the scaffolding it does have (headings, tag lines)
 * stands in, so the preview is empty only when the note says nothing at all.
 */
export function buildPreviewText(body: string, parts: PreviewParts): string {
  const noise = [...parts.noise, ...parts.spans.noise]
  const noiseSpans = plainTextSpans(noise, parts.literalRanges)
  const content: Cut[] = [
    ...noise,
    ...parts.tables.map((table) => ({
      from: table.from,
      to: table.to,
      text: ` ${tablePreviewText(tableRows(body, table, noiseSpans))} `,
    })),
  ]
  const prose = buildPlainText(
    body,
    [...content, ...parts.headings, ...parts.spans.scaffolding],
    parts.literalRanges,
  )
  return prose !== '' ? prose : buildPlainText(body, content, parts.literalRanges)
}
