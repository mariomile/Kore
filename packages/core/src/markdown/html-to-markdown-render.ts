/**
 * Render a parsed HTML fragment as GitHub-flavored markdown.
 */

import type { HtmlElement, HtmlNode } from './html-to-markdown-parse'

export interface MarkdownRenderContext {
  readonly baseUrl: string | undefined
}

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'template',
  'video',
  'audio',
  'object',
  'embed',
])

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

/** Render parsed nodes as markdown blocks separated by blank lines. */
export function renderHtmlFragment(
  nodes: readonly HtmlNode[],
  context: MarkdownRenderContext,
): string {
  const blocks: string[] = []
  let inlineRun: HtmlNode[] = []

  function flushInline(): void {
    const text = renderInlineNodes(inlineRun, context).trim()
    inlineRun = []
    if (text !== '') {
      blocks.push(text)
    }
  }

  for (const node of nodes) {
    if (node.kind === 'element' && (BLOCK_TAGS.has(node.tag) || elementHasBlockChild(node))) {
      flushInline()
      const block = renderBlock(node, context).trim()
      if (block !== '') {
        blocks.push(block)
      }
    } else if (node.kind !== 'element' || !SKIP_TAGS.has(node.tag)) {
      inlineRun.push(node)
    }
  }
  flushInline()
  return blocks.join('\n\n')
}

function elementHasBlockChild(element: HtmlElement): boolean {
  return element.children.some(
    (child) =>
      child.kind === 'element' && (BLOCK_TAGS.has(child.tag) || elementHasBlockChild(child)),
  )
}

function renderBlock(element: HtmlElement, context: MarkdownRenderContext): string {
  if (SKIP_TAGS.has(element.tag)) {
    return ''
  }
  switch (element.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(element.tag.slice(1))
      const heading = renderInlineNodes(element.children, context).trim()
      return heading === '' ? '' : `${'#'.repeat(level)} ${heading}`
    }
    case 'p':
    case 'dt':
    case 'figcaption':
      return renderInlineNodes(element.children, context).trim()
    case 'blockquote': {
      const inner = renderHtmlFragment(element.children, context)
      if (inner === '') {
        return ''
      }
      return inner
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n')
    }
    case 'pre':
      return renderPre(element)
    case 'ul':
      return renderList(element, false, context, 0)
    case 'ol':
      return renderList(element, true, context, 0)
    case 'li':
      return renderHtmlFragment(element.children, context)
    case 'hr':
      return '---'
    case 'table':
      return renderTable(element, context)
    case 'br':
      return ''
    default:
      return renderHtmlFragment(element.children, context)
  }
}

function renderList(
  element: HtmlElement,
  ordered: boolean,
  context: MarkdownRenderContext,
  depth: number,
): string {
  const items = element.children.filter(
    (child): child is HtmlElement => child.kind === 'element' && child.tag === 'li',
  )
  const indent = '  '.repeat(depth)
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- '
      const nestedLists: HtmlElement[] = []
      const inline: HtmlNode[] = []
      for (const child of item.children) {
        if (child.kind === 'element' && (child.tag === 'ul' || child.tag === 'ol')) {
          nestedLists.push(child)
        } else if (
          child.kind === 'element' &&
          child.tag === 'p' &&
          inline.length === 0 &&
          nestedLists.length === 0
        ) {
          inline.push(...child.children)
        } else {
          inline.push(child)
        }
      }
      const head = renderInlineNodes(inline, context).trim()
      const nested = nestedLists
        .map((list) => renderList(list, list.tag === 'ol', context, depth + 1))
        .filter(Boolean)
        .join('\n')
      const firstLine = `${indent}${marker}${head}`
      return nested === '' ? firstLine : `${firstLine}\n${nested}`
    })
    .join('\n')
}

function renderPre(element: HtmlElement): string {
  const code = element.children.find(
    (child): child is HtmlElement => child.kind === 'element' && child.tag === 'code',
  )
  const language = code === undefined ? '' : fenceLanguage(code.attrs['class'] ?? '')
  const text = collectText(code ?? element)
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1))
  const body = text.replace(/^\n+/, '').replace(/\n+$/, '')
  return language === '' ? `${fence}\n${body}\n${fence}` : `${fence}${language}\n${body}\n${fence}`
}

function fenceLanguage(className: string): string {
  const match = /(?:^|\s)(?:language|lang)-([\w+-]+)/.exec(className)
  return match?.[1] ?? ''
}

function renderTable(element: HtmlElement, context: MarkdownRenderContext): string {
  const rows = collectTableRows(element)
  if (rows.length === 0) {
    return ''
  }
  const width = Math.max(...rows.map((row) => row.length), 1)
  const padded = rows.map((row) => {
    const cells = row.map((cell) => escapeTableCell(renderInlineNodes(cell, context).trim()))
    while (cells.length < width) {
      cells.push('')
    }
    return cells
  })
  const header = padded[0]
  if (header === undefined) {
    return ''
  }
  const separator = header.map(() => '---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...padded.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ]
  return lines.join('\n')
}

function collectTableRows(element: HtmlElement): HtmlNode[][][] {
  const rows: HtmlNode[][][] = []
  function walk(node: HtmlElement): void {
    if (node.tag === 'tr') {
      const cells = node.children.filter(
        (child): child is HtmlElement =>
          child.kind === 'element' && (child.tag === 'td' || child.tag === 'th'),
      )
      rows.push(cells.map((cell) => cell.children))
      return
    }
    for (const child of node.children) {
      if (child.kind === 'element') {
        walk(child)
      }
    }
  }
  walk(element)
  return rows
}

function escapeTableCell(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')
}

function renderInlineNodes(nodes: readonly HtmlNode[], context: MarkdownRenderContext): string {
  // Whitespace collapses per text node and at part boundaries — never across
  // a rendered code span, whose internal spacing (and the ` padding around
  // backtick-edged code) is meaningful markdown.
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') {
      const text = collapseInlineWhitespace(escapeInline(node.value))
      out += out.endsWith(' ') ? text.replace(/^ +/, '') : text
      continue
    }
    if (SKIP_TAGS.has(node.tag)) {
      continue
    }
    const rendered = renderInlineElement(node, context)
    out += out.endsWith(' ') && node.tag !== 'code' ? rendered.replace(/^ +/, '') : rendered
  }
  return out
}

function renderInlineElement(element: HtmlElement, context: MarkdownRenderContext): string {
  switch (element.tag) {
    case 'br':
      return '\\\n'
    case 'strong':
    case 'b':
      return wrapInline(renderInlineNodes(element.children, context), '**')
    case 'em':
    case 'i':
      return wrapInline(renderInlineNodes(element.children, context), '*')
    case 'del':
    case 's':
    case 'strike':
      return wrapInline(renderInlineNodes(element.children, context), '~~')
    case 'code':
      return renderInlineCode(collectText(element))
    case 'a':
      return renderLink(element, context)
    case 'img':
      return renderImage(element, context)
    default:
      if (BLOCK_TAGS.has(element.tag)) {
        return renderHtmlFragment([element], context)
      }
      return renderInlineNodes(element.children, context)
  }
}

function wrapInline(inner: string, delimiter: string): string {
  const trimmed = inner.trim()
  return trimmed === '' ? '' : `${delimiter}${trimmed}${delimiter}`
}

function renderInlineCode(text: string): string {
  if (text === '') {
    return ''
  }
  const fence = '`'.repeat(Math.max(1, longestBacktickRun(text) + 1))
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text
  return `${fence}${padded}${fence}`
}

function renderLink(element: HtmlElement, context: MarkdownRenderContext): string {
  const href = element.attrs['href']
  const label = renderInlineNodes(element.children, context).trim()
  if (href === undefined || href === '' || !isSafeUrl(href, ['http', 'https', 'mailto'])) {
    return label
  }
  const resolved = resolveUrl(href, context.baseUrl)
  if (label === '') {
    return `<${resolved}>`
  }
  return `[${label}](${escapeUrl(resolved)})`
}

function renderImage(element: HtmlElement, context: MarkdownRenderContext): string {
  const src = element.attrs['src']
  if (
    src === undefined ||
    src === '' ||
    src.startsWith('data:') ||
    !isSafeUrl(src, ['http', 'https'])
  ) {
    return ''
  }
  const resolved = resolveUrl(src, context.baseUrl)
  const alt = collapseInlineWhitespace(element.attrs['alt'] ?? '').trim()
  return `![${alt}](${escapeUrl(resolved)})`
}

function isSafeUrl(value: string, allowed: readonly string[]): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value.trim())
  if (scheme === null || scheme[1] === undefined) {
    return true
  }
  return allowed.includes(scheme[1].toLowerCase())
}

function resolveUrl(value: string, baseUrl: string | undefined): string {
  if (baseUrl === undefined || baseUrl === '') {
    return value
  }
  try {
    return new URL(value, baseUrl).href
  } catch {
    return value
  }
}

function escapeUrl(value: string): string {
  return value.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll(' ', '%20')
}

function escapeInline(text: string): string {
  return text.replaceAll(/([\\`*_[\]~])/g, String.raw`\$1`)
}

function collapseInlineWhitespace(text: string): string {
  return text.replaceAll(/[ \t\n\r\f]+/g, ' ')
}

function collectText(node: HtmlNode): string {
  if (node.kind === 'text') {
    return node.value
  }
  return node.children.map(collectText).join('')
}

function longestBacktickRun(text: string): number {
  let longest = 0
  let current = 0
  for (const character of text) {
    if (character === '`') {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }
  return longest
}
