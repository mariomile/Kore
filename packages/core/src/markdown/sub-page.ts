import { splitFrontmatter } from './frontmatter'

/**
 * Sub pages (Craft's "Turn into Page"): a block becomes a note of its own and
 * the line it leaves behind is a bare `[[Title]]`, which the editor draws as
 * a page card. The Markdown stays plain: the card is only a way of drawing a
 * paragraph that holds nothing but one wiki link.
 */

const BARE_WIKI_LINK = /^\[\[([^[\]#|]+)(?:\|[^[\]]*)?\]\]$/
const DUE_DATE = /\s*\[\[\d{4}-\d{2}-\d{2}\]\]\s*/g
const TITLE_MAX = 120
const PREVIEW_MAX = 140

/** The note a line draws as a page card, or null when the line is anything else. */
export function pageCardTarget(text: string): string | null {
  const match = BARE_WIKI_LINK.exec(text.trim())
  const target = match?.[1]?.trim() ?? ''
  if (target === '' || /^\d{4}-\d{2}-\d{2}$/.test(target)) return null
  return target
}

export interface SubPagePlan {
  /** The new note's title, and the text of the link left behind. */
  readonly title: string
  /** The block's children, as the new note's body (may be empty). */
  readonly body: string
  /** The line that replaces the block. */
  readonly link: string
}

/**
 * Plan turning a block into a page: its first line is the title (a task's
 * due date and any surrounding brackets dropped), its children the body.
 * Null when the line has no words to name a note with.
 */
export function planSubPage(firstLine: string, childrenMarkdown: string): SubPagePlan | null {
  const title = firstLine
    .replaceAll(DUE_DATE, ' ')
    .replaceAll(/\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g, (_, target: string, label?: string) =>
      (label ?? target).trim(),
    )
    .replaceAll(/[[\]#|^]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX)
    .trim()
  if (title === '') return null
  return { title, body: dedent(childrenMarkdown).trim(), link: `[[${title}]]` }
}

/** Strip the indent the children carried under their parent. */
function dedent(markdown: string): string {
  const lines = markdown.split('\n')
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
  const common = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map((line) => line.slice(common)).join('\n')
}

/**
 * The card's two-line preview of a page: its text without frontmatter, the
 * H1 that repeats the title, list and heading markup, or link brackets.
 */
export function subPagePreview(source: string): string {
  const { body } = splitFrontmatter(source)
  const text = body
    .split('\n')
    .filter((line) => !/^#\s/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ x]\]\s+)?/i, '')
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replaceAll(/\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g, (_, target: string, label?: string) =>
          (label ?? target).trim(),
        )
        .replaceAll(/[*_`~]/g, '')
        .trim(),
    )
    .filter((line) => line !== '')
    .join(' · ')
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX).trimEnd()}…`
}
