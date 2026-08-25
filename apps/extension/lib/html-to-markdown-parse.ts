/**
 * HTML fragment parser used by {@link htmlToMarkdown}. Kept separate so the
 * converter stays under the repo's 500-line lint budget.
 */

export interface HtmlElement {
  readonly kind: 'element'
  readonly tag: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: HtmlNode[]
}

export interface HtmlText {
  readonly kind: 'text'
  readonly value: string
}

export type HtmlNode = HtmlElement | HtmlText

interface MutableElement {
  kind: 'element'
  tag: string
  attrs: Record<string, string>
  children: HtmlNode[]
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Parse an HTML fragment into a small element/text tree. */
export function parseHtmlFragment(html: string): HtmlNode[] {
  const root: HtmlNode[] = []
  const stack: MutableElement[] = []

  function currentChildren(): HtmlNode[] {
    const parent = stack.at(-1)
    return parent === undefined ? root : parent.children
  }

  let cursor = 0
  while (cursor < html.length) {
    if (html.startsWith('<!--', cursor)) {
      const commentEnd = html.indexOf('-->', cursor + 4)
      cursor = commentEnd === -1 ? html.length : commentEnd + 3
      continue
    }
    if (html.startsWith('<!', cursor) || html.startsWith('<?', cursor)) {
      const declarationEnd = html.indexOf('>', cursor)
      cursor = declarationEnd === -1 ? html.length : declarationEnd + 1
      continue
    }
    if (html.startsWith('</', cursor)) {
      const close = readCloseTag(html, cursor)
      if (close === null) {
        currentChildren().push({ kind: 'text', value: html[cursor] ?? '' })
        cursor += 1
        continue
      }
      closeUntil(stack, close.tag)
      cursor = close.end
      continue
    }
    if (html[cursor] === '<') {
      const open = readOpenTag(html, cursor)
      if (open === null) {
        currentChildren().push({ kind: 'text', value: '<' })
        cursor += 1
        continue
      }
      const element: MutableElement = {
        kind: 'element',
        tag: open.tag,
        attrs: open.attrs,
        children: [],
      }
      currentChildren().push(element)
      cursor = open.end
      // A self-closed raw-text tag (XHTML/SVG serializations emit
      // `<script src="x"/>`) has no raw content and no closing tag — scanning
      // for one would swallow the rest of the document.
      if (RAW_TEXT_TAGS.has(open.tag) && !open.selfClosing) {
        const raw = readRawText(html, cursor, open.tag)
        if (open.tag !== 'script' && open.tag !== 'style' && raw.text !== '') {
          element.children.push({ kind: 'text', value: raw.text })
        }
        cursor = raw.end
        continue
      }
      if (!open.selfClosing && !VOID_TAGS.has(open.tag)) {
        stack.push(element)
      }
      continue
    }
    const nextTag = html.indexOf('<', cursor)
    const textEnd = nextTag === -1 ? html.length : nextTag
    currentChildren().push({ kind: 'text', value: decodeEntities(html.slice(cursor, textEnd)) })
    cursor = textEnd
  }
  return root
}

function closeUntil(stack: MutableElement[], tag: string): void {
  const index = stack.findLastIndex((element) => element.tag === tag)
  if (index === -1) {
    return
  }
  stack.length = index
}

interface OpenTag {
  readonly tag: string
  readonly attrs: Record<string, string>
  readonly selfClosing: boolean
  readonly end: number
}

interface CloseTag {
  readonly tag: string
  readonly end: number
}

// Sticky (/y) tokens anchored via lastIndex, so no per-token copy of the
// remaining document is ever made — a large page parses in linear time.
const OPEN_TAG_RE = /<([a-z][\w:-]*)/iy

function readOpenTag(html: string, start: number): OpenTag | null {
  OPEN_TAG_RE.lastIndex = start
  const match = OPEN_TAG_RE.exec(html)
  if (match === null || match[1] === undefined) {
    return null
  }
  const tag = match[1].toLowerCase()
  let cursor = start + match[0].length
  const attrs: Record<string, string> = {}
  while (cursor < html.length) {
    while (cursor < html.length && /\s/.test(html[cursor] ?? '')) {
      cursor += 1
    }
    if (html.startsWith('/>', cursor)) {
      return { tag, attrs, selfClosing: true, end: cursor + 2 }
    }
    if (html[cursor] === '>') {
      return { tag, attrs, selfClosing: false, end: cursor + 1 }
    }
    const attr = readAttribute(html, cursor)
    if (attr === null) {
      const fallback = html.indexOf('>', cursor)
      return fallback === -1 ? null : { tag, attrs, selfClosing: false, end: fallback + 1 }
    }
    attrs[attr.name] = attr.value
    cursor = attr.end
  }
  return null
}

const CLOSE_TAG_RE = /<\/([a-z][\w:-]*)\s*>/iy

function readCloseTag(html: string, start: number): CloseTag | null {
  CLOSE_TAG_RE.lastIndex = start
  const match = CLOSE_TAG_RE.exec(html)
  if (match === null || match[1] === undefined) {
    return null
  }
  return { tag: match[1].toLowerCase(), end: CLOSE_TAG_RE.lastIndex }
}

interface ParsedAttribute {
  readonly name: string
  readonly value: string
  readonly end: number
}

const ATTRIBUTE_RE = /([^\s"'></=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y

function readAttribute(html: string, start: number): ParsedAttribute | null {
  ATTRIBUTE_RE.lastIndex = start
  const match = ATTRIBUTE_RE.exec(html)
  if (match === null || match[1] === undefined) {
    return null
  }
  const rawValue = match[2] ?? match[3] ?? match[4] ?? ''
  return {
    name: match[1].toLowerCase(),
    value: decodeEntities(rawValue),
    end: ATTRIBUTE_RE.lastIndex,
  }
}

function readRawText(html: string, start: number, tag: string): { text: string; end: number } {
  const closeRe = new RegExp(String.raw`</${tag}\s*>`, 'gi')
  closeRe.lastIndex = start
  const match = closeRe.exec(html)
  if (match === null) {
    return { text: decodeEntities(html.slice(start)), end: html.length }
  }
  return { text: decodeEntities(html.slice(start, match.index)), end: match.index }
}

function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (full, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return codePointToChar(Number.parseInt(body.slice(2), 16), full)
    }
    if (body.startsWith('#')) {
      return codePointToChar(Number.parseInt(body.slice(1), 10), full)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? full
  })
}

function codePointToChar(code: number, fallback: string): string {
  if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff) {
    return fallback
  }
  if (code >= 0xd800 && code <= 0xdfff) {
    return fallback
  }
  return String.fromCodePoint(code)
}
