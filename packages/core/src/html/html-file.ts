/**
 * HTML files in the vault: pages AI tools write in bulk (reports,
 * dashboards, decks). Kore shows them as documents, like a PDF, never as
 * notes; the `kore-asset` protocol serves them sandboxed.
 */

import { assetUrl } from '../ipc/bridge'

/** True for a vault path that names an HTML file (`.html` or `.htm`). */
export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path.split('#')[0]!.trim())
}

/** Display name of an HTML file: its file name without the extension. */
export function htmlDisplayName(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.html?$/i, '')
}

/** How much of a page {@link htmlDocumentTitle} reads: the head, with room. */
export const HTML_TITLE_SCAN_CHARS = 64 * 1024

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

function plainText(markup: string): string {
  return decodeEntities(markup.replaceAll(/<[^>]*>/g, ' '))
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/**
 * The title a page shows its reader: its `<title>`, else its first `<h1>`,
 * else null. Reads only the first {@link HTML_TITLE_SCAN_CHARS} characters,
 * skipping scripts, styles and comments, so a huge inline bundle costs
 * nothing.
 */
export function htmlDocumentTitle(source: string): string | null {
  const head = source
    .slice(0, HTML_TITLE_SCAN_CHARS)
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  for (const pattern of [
    /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i,
    /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i,
  ]) {
    const match = pattern.exec(head)
    const text = match?.[1] === undefined ? '' : plainText(match[1])
    if (text !== '') {
      return text
    }
  }
  return null
}

/**
 * The URL an HTML file renders from: its asset URL with the path's slashes
 * left as slashes, so the page's relative links (`img/chart.png`) resolve
 * beside it in the vault instead of at the vault root.
 */
export function htmlPageUrl(generation: number, path: string): string | null {
  return assetUrl(generation, path)?.replaceAll('%2F', '/') ?? null
}
