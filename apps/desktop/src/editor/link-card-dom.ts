import type { LinkPreview, LinkPreviewProvider, PostLinkPreview } from '@kore/core'

/**
 * The DOM of one link preview card. Built by hand because it renders as a
 * ProseMirror widget (outside React), and drawn by `styles/link-cards.css`.
 * Every string goes in as text, never as markup: the copy came off the
 * network.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Brand marks, so a card names its source the way the reference does. */
const BRAND_PATHS: Record<LinkPreviewProvider, string> = {
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

/**
 * An image that shows only once it has loaded, and removes itself if its host
 * refuses: no broken-image glyph, and no empty slot left for a favicon a site
 * never had.
 */
function image(className: string, src: string): HTMLImageElement {
  const img = element('img', className)
  img.alt = ''
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.draggable = false
  img.hidden = true
  img.addEventListener('load', () => {
    img.hidden = false
  })
  img.addEventListener('error', () => {
    img.remove()
  })
  img.src = src
  return img
}

function brandMark(provider: LinkPreviewProvider): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'kore-link-card-icon')
  svg.dataset.brand = provider
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', BRAND_PATHS[provider])
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** `28 replies`, `1 repost`, `1.2K likes`. */
export function countLabel(value: number, singular: string, plural: string): string {
  return `${compact.format(value)} ${value === 1 ? singular : plural}`
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** `5 Nov 2026`, or null for a post with no date. */
export function postDate(iso: string | null): string | null {
  if (iso === null) {
    return null
  }
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : dateFormat.format(time)
}

/** The footer line: the site's mark and name, then whatever else it knows. */
function siteLine(preview: LinkPreview, extras: readonly string[]): HTMLElement {
  const line = element('div', 'kore-link-card-site')
  if (preview.provider !== null) {
    line.append(brandMark(preview.provider))
  } else if (preview.iconUrl !== null) {
    line.append(image('kore-link-card-icon', preview.iconUrl))
  }
  line.append(element('span', '', [preview.siteName, ...extras].join(' · ')))
  return line
}

function postCard(card: HTMLElement, preview: PostLinkPreview): void {
  const header = element('div', 'kore-link-card-author')
  if (preview.avatarUrl !== null) {
    header.append(image('kore-link-card-avatar', preview.avatarUrl))
  }
  const names = element('div', 'kore-link-card-names')
  names.append(element('span', 'kore-link-card-name', preview.authorName))
  const date = postDate(preview.publishedAt)
  names.append(
    element(
      'span',
      'kore-link-card-handle',
      date === null ? `@${preview.authorHandle}` : `@${preview.authorHandle} · ${date}`,
    ),
  )
  header.append(names)
  card.append(header)
  if (preview.text !== '') {
    card.append(element('div', 'kore-link-card-text', preview.text))
  }
  if (preview.imageUrl !== null) {
    card.append(image('kore-link-card-media', preview.imageUrl))
  }
  const counts: string[] = []
  if (preview.replies !== null) counts.push(countLabel(preview.replies, 'reply', 'replies'))
  if (preview.reposts !== null) counts.push(countLabel(preview.reposts, 'repost', 'reposts'))
  if (preview.likes !== null) counts.push(countLabel(preview.likes, 'like', 'likes'))
  card.append(siteLine(preview, counts))
}

/** One card for one preview. The caller owns events and placement. */
export function linkCardElement(preview: LinkPreview): HTMLElement {
  const card = element('div', 'kore-link-card')
  card.contentEditable = 'false'
  card.dataset.kind = preview.kind
  if (preview.provider !== null) {
    card.dataset.provider = preview.provider
  }
  card.title = preview.url
  if (preview.kind === 'post') {
    postCard(card, preview)
    return card
  }
  const body = element('div', 'kore-link-card-body')
  body.append(element('div', 'kore-link-card-title', preview.title))
  if (preview.description !== null && preview.description !== preview.title) {
    body.append(element('div', 'kore-link-card-description', preview.description))
  }
  body.append(siteLine(preview, []))
  card.append(body)
  if (preview.imageUrl !== null) {
    card.append(image('kore-link-card-thumb', preview.imageUrl))
  }
  return card
}
