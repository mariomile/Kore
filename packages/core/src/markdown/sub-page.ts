import { hiddenBlockIdTail, lineBlockId, newBlockId, withoutBlockIds } from './block-ids'

/**
 * Sub pages (Craft's page blocks, Mario 2026-11-15): a page is a list item
 * that stays in its note, children and all, and is drawn as a card; opening
 * it is the block zoom. What makes an item a page is the hidden block id at
 * the end of its first line, `^page-xxxxxx`: Obsidian reads a plain bullet
 * (and `[[Note#^page-xxxxxx]]` links to it), Kore hides the marker like any
 * block id. Links to other notes stay links.
 */

export const PAGE_ID_PREFIX = 'page-'
const PREVIEW_MAX = 140

/** True for a block id that marks a page. */
export function isPageBlockId(id: string): boolean {
  return id.startsWith(PAGE_ID_PREFIX) && id.length > PAGE_ID_PREFIX.length
}

/** The page id a line ends with, or null when the line is not a page's. */
export function linePageId(line: string): string | null {
  const id = lineBlockId(line)
  return id !== null && isPageBlockId(id) ? id : null
}

/** A fresh page id (`page-` and six letters or digits). */
export function newPageBlockId(random: () => number = Math.random): string {
  return `${PAGE_ID_PREFIX}${newBlockId(random)}`
}

/**
 * Inline Markdown as a reader sees it: a wiki link or a link reads as its
 * label, an image as its alt text, emphasis and code marks go.
 */
function plainInline(text: string): string {
  return text
    .replaceAll(/\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g, (_, target: string, label?: string) =>
      (label ?? target).trim(),
    )
    .replaceAll(/!?\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1')
    .replaceAll(/\*\*|__|~~|[*`]/g, '')
    .replaceAll(/\(\s*\)/g, '')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
}

/** The page's title as the card shows it: its first line, plain, without the marker. */
export function pageTitle(line: string): string {
  const tail = hiddenBlockIdTail(line)
  return plainInline(tail === null ? line : line.slice(0, tail.start))
}

/**
 * The card's two-line preview of a page from its children's Markdown: text
 * only, without list, heading or quote markup, block ids or link brackets,
 * lines joined by a middle dot.
 */
export function pagePreview(markdown: string): string {
  const text = withoutBlockIds(markdown)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ x]\]\s+)?/i, '')
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, ''),
    )
    .map(plainInline)
    .filter((line) => line !== '')
    .join(' · ')
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX).trimEnd()}…`
}
