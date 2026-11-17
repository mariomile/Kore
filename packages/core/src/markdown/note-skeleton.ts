import { splitFrontmatter } from './frontmatter'

/**
 * A note in miniature (Craft's page icon is the page itself, shrunk): its
 * first blocks as abstract rows — headings bold, list items with their
 * bullet, numeral or box, quotes with their rule — so a chat source or a
 * rail row can show *which* page it is at a glance. The editor's sub-page
 * card draws the same rows from its ProseMirror node
 * (`apps/desktop/src/editor/page-block-plugin.ts`); this reads markdown, for
 * notes that are not open.
 */

export type NoteSkeletonKind =
  | 'heading'
  | 'text'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'done'
  | 'quote'
  /** A fenced block (code, a diagram, a query) drawn as one filled bar. */
  | 'block'

export interface NoteSkeletonRow {
  readonly kind: NoteSkeletonKind
  /** Nesting level, 0 at the top. */
  readonly depth: number
  /** Share of the line the text fills, 0.3 to 1. */
  readonly width: number
}

/** Rows a thumbnail draws: what fits on a sheet a few dozen pixels tall. */
export const NOTE_SKELETON_ROWS = 6

/** Only the head of a long note can reach the thumbnail. */
const SCAN_MAX_CHARS = 4_000

function widthOf(text: string): number {
  return Math.round(Math.min(1, Math.max(0.3, text.trim().length / 36)) * 100) / 100
}

/** Leading indentation as a nesting level: a tab or two spaces per level. */
function depthOf(indent: string): number {
  const columns = [...indent].reduce((sum, char) => sum + (char === '\t' ? 2 : 1), 0)
  return Math.min(2, Math.floor(columns / 2))
}

/**
 * The skeleton of a markdown note: frontmatter skipped, the leading `# Title`
 * skipped (the row's title already says it), each fenced block one filled
 * bar, tables, images and blank lines dropped, at most {@link NOTE_SKELETON_ROWS} rows.
 */
export function noteSkeleton(source: string): NoteSkeletonRow[] {
  const body = splitFrontmatter(source.slice(0, SCAN_MAX_CHARS)).body
  const rows: NoteSkeletonRow[] = []
  let inFence = false
  let seenContent = false
  for (const line of body.split('\n')) {
    if (rows.length >= NOTE_SKELETON_ROWS) break
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (!inFence) {
        // An Obsidian admonition fence reads as a callout, anything else as
        // a block: either way one row, never its contents.
        const callout = /^\s*(?:```|~~~)\s*ad-/.test(line)
        rows.push({ kind: callout ? 'quote' : 'block', depth: 0, width: callout ? 0.7 : 1 })
        seenContent = true
      }
      inFence = !inFence
      continue
    }
    if (inFence || line.trim() === '') continue
    if (/^\s*(?:\||!\[|<!--|---\s*$|\^[\w-]+\s*$)/.test(line)) continue

    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      // The first heading of the note is its title: the row already shows it.
      if (!seenContent && line.startsWith('# ')) {
        seenContent = true
        continue
      }
      rows.push({ kind: 'heading', depth: 0, width: widthOf(heading[1] ?? '') })
      seenContent = true
      continue
    }
    seenContent = true

    const task = /^(\s*)[-*+]\s+\[([ x])\]\s*(.*)$/i.exec(line)
    if (task) {
      rows.push({
        kind: task[2] === ' ' ? 'task' : 'done',
        depth: depthOf(task[1] ?? ''),
        width: widthOf(task[3] ?? ''),
      })
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      rows.push({
        kind: 'bullet',
        depth: depthOf(bullet[1] ?? ''),
        width: widthOf(bullet[2] ?? ''),
      })
      continue
    }
    const ordered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      rows.push({
        kind: 'ordered',
        depth: depthOf(ordered[1] ?? ''),
        width: widthOf(ordered[2] ?? ''),
      })
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      rows.push({ kind: 'quote', depth: 0, width: widthOf(quote[1] ?? '') })
      continue
    }
    rows.push({ kind: 'text', depth: 0, width: widthOf(line) })
  }
  return rows
}
