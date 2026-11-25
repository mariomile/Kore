import {
  embedPlayer,
  type EmbedLayout,
  type EmbedPlayer,
  type LinkPreview,
  type LinkPreviewProvider,
  type PageLinkPreview,
  type PostLinkPreview,
} from '@kore/core'
import { claimPlayback, releasePlayback } from './playback'

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

/** `https://www.captoo.io/x` → `captoo.io`; the raw string when unparsable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * The event a card's appearance button fires, bubbling to the editor, where
 * `LinkLayoutMenu` opens the Inline link / Compact / Card / Large menu.
 */
export const LINK_LAYOUT_EVENT = 'kore-link-layout'

export interface LinkLayoutRequest {
  readonly url: string
  /** The page's title when known: what an inline link is named after. */
  readonly title: string | null
  readonly layout: EmbedLayout
}

/** Ask the editor for the appearance menu, anchored on `button`. */
export function requestLinkLayout(button: HTMLElement, request: LinkLayoutRequest): void {
  button.dispatchEvent(
    new CustomEvent<LinkLayoutRequest>(LINK_LAYOUT_EVENT, { bubbles: true, detail: request }),
  )
}

function strokeGlyph(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

/** A footer button: a 28px glyph with a 44px hit area (see link-cards.css). */
function footerButton(label: string, glyph: SVGSVGElement): HTMLButtonElement {
  const button = element('button', 'kore-link-card-button')
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.title = label
  button.append(glyph)
  return button
}

/** The arrow-out-of-box glyph the open button draws. */
function openGlyph(): SVGSVGElement {
  return strokeGlyph([
    'M14 4h6v6',
    'M20 4l-9 9',
    'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  ])
}

/** Two stacked cards: the appearance glyph. */
function layoutGlyph(): SVGSVGElement {
  return strokeGlyph(['M4 5h16v8H4z', 'M4 17h16', 'M4 20h10'])
}

/**
 * The footer line: the site's mark and name (and its host when the name is
 * something else), whatever else it knows, then the appearance and open
 * buttons. Open is the only way to open the link with a thumb: a plain press
 * on the card puts the caret on its source instead.
 */
function siteLine(
  preview: LinkPreview,
  extras: readonly string[],
  layout: EmbedLayout,
  appearance = true,
): HTMLElement {
  const line = element('div', 'kore-link-card-site')
  if (preview.provider !== null) {
    line.append(brandMark(preview.provider))
  } else if (preview.iconUrl !== null) {
    line.append(image('kore-link-card-icon', preview.iconUrl))
  }
  const host = hostOf(preview.url)
  const name = preview.siteName.toLowerCase() === host ? [host] : [preview.siteName, host]
  line.append(element('span', '', [...name, ...extras].join(' · ')))
  if (appearance) {
    const button = footerButton('Link appearance', layoutGlyph())
    button.dataset.linkCardLayout = ''
    button.addEventListener('click', (event) => {
      event.preventDefault()
      requestLinkLayout(button, {
        url: preview.url,
        title: preview.kind === 'page' ? preview.title : null,
        layout,
      })
    })
    line.append(button)
  }
  const open = footerButton(`Open ${host}`, openGlyph())
  open.dataset.linkCardOpen = ''
  line.append(open)
  return line
}

function postCard(card: HTMLElement, preview: PostLinkPreview, layout: EmbedLayout): void {
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
  card.append(siteLine(preview, counts, layout))
}

/**
 * Everything a player frame may do: run its own scripts in its own origin,
 * open the provider in a new window, go fullscreen. Never navigate the app.
 * Shared by every card that holds a player (`EmbeddedLinkCard` too).
 */
export const PLAYER_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms'

/** What a player frame may ask the browser for. */
export const PLAYER_ALLOW =
  'autoplay; accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen'

/** The provider's player, ready to drop in where the card was. */
export function playerFrame(player: EmbedPlayer, title: string): HTMLIFrameElement {
  const frame = element('iframe', 'kore-link-card-frame')
  frame.src = player.url
  frame.title = `${player.provider}: ${title}`
  frame.allow = PLAYER_ALLOW
  frame.allowFullscreen = true
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.setAttribute('sandbox', PLAYER_SANDBOX)
  if (player.height !== null) {
    frame.style.height = `${player.height}px`
  } else {
    frame.dataset.ratio = 'video'
  }
  return frame
}

/** The filled triangle a Play button draws. */
function playGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute(
    'd',
    'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  )
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

/** The cross a player's close button draws. */
function closeGlyph(): SVGSVGElement {
  return strokeGlyph(['M6 6l12 12', 'M18 6L6 18'])
}

/** The stop of the card playing right now, if one is. */
let playingStop: (() => void) | null = null

/** Stop whatever card is playing, putting its card back. */
export function stopLinkCardPlayer(): void {
  playingStop?.()
}

/**
 * Swap `card`'s contents for the provider's player. The card element itself
 * stays (it is a ProseMirror widget's root), so the editor never notices.
 * The player goes away, and the card comes back, on the close button, on
 * another card's Play, or once a video scrolls out of view: no video keeps
 * playing, or loading, off screen.
 */
function startPlayer(card: HTMLElement, player: EmbedPlayer, title: string): void {
  const saved = [...card.childNodes]
  const stage = element('div', 'kore-link-card-player')
  const close = footerButton('Close player', closeGlyph())
  close.classList.add('kore-link-card-close')
  close.dataset.linkCardClose = ''
  stage.append(playerFrame(player, title), close)
  card.dataset.playing = ''
  card.replaceChildren(stage)

  let observer: IntersectionObserver | null = null
  const stop = (): void => {
    observer?.disconnect()
    observer = null
    card.replaceChildren(...saved)
    delete card.dataset.playing
    releasePlayback(stop)
    if (playingStop === stop) {
      playingStop = null
    }
  }
  close.addEventListener('click', (event) => {
    event.preventDefault()
    stop()
  })
  // A video stops once it leaves the screen; an audio player (it has a
  // fixed height) keeps going while you scroll, as music should.
  if (player.height === null && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting) || !card.isConnected) {
        stop()
      }
    })
    observer.observe(card)
  }
  claimPlayback(stop)
  playingStop = stop
}

/**
 * The poster of a card whose link has a player: the page's image (when it
 * has one) under a round Play button. It takes the thumbnail's place in the
 * layout, so Card and Large draw it where the image would be.
 */
function poster(preview: PageLinkPreview, player: EmbedPlayer): HTMLElement {
  const slot = element('div', 'kore-link-card-thumb kore-link-card-poster')
  if (preview.imageUrl !== null) {
    slot.append(image('kore-link-card-poster-image', preview.imageUrl))
  }
  slot.append(playButton(player, 'kore-link-card-play'))
  return slot
}

function playButton(player: EmbedPlayer, className: string): HTMLButtonElement {
  const label = player.playable ? `Play on ${player.provider}` : `Show ${player.provider}`
  const button = element('button', className)
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.title = label
  button.dataset.linkCardPlay = ''
  button.append(playGlyph())
  return button
}

/** How a card differs from a pasted link's. */
export interface LinkCardSource {
  /** The player Play loads; by default the link's own provider player. */
  readonly player?: EmbedPlayer | null
  /**
   * Whether the footer offers the appearance menu. Only a pasted link has an
   * appearance to change (its layout lives with the link).
   */
  readonly appearance?: boolean
}

/**
 * One card for one preview, in one of the three card layouts. The caller owns
 * events and placement; the appearance button fires {@link LINK_LAYOUT_EVENT}.
 */
export function linkCardElement(
  preview: LinkPreview,
  layout: EmbedLayout = 'card',
  { player = embedPlayer(preview.url), appearance = true }: LinkCardSource = {},
): HTMLElement {
  const card = element('div', 'kore-link-card')
  card.contentEditable = 'false'
  card.dataset.kind = preview.kind
  card.dataset.layout = layout
  if (preview.provider !== null) {
    card.dataset.provider = preview.provider
  }
  card.title = preview.url
  if (preview.kind === 'post') {
    postCard(card, preview, layout)
    return card
  }
  const body = element('div', 'kore-link-card-body')
  body.append(element('div', 'kore-link-card-title', preview.title))
  if (preview.description !== null && preview.description !== preview.title) {
    body.append(element('div', 'kore-link-card-description', preview.description))
  }
  const site = siteLine(preview, [], layout, appearance)
  if (player !== null) {
    // Compact has no image to put the button on: it sits in the footer.
    site.lastElementChild?.before(
      playButton(player, 'kore-link-card-button kore-link-card-play-inline'),
    )
  }
  body.append(site)
  card.append(body)
  if (player !== null) {
    card.dataset.player = player.provider
    card.append(poster(preview, player))
    card.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-link-card-play]')) {
        event.preventDefault()
        startPlayer(card, player, preview.title)
      }
    })
  } else if (preview.imageUrl !== null) {
    card.append(image('kore-link-card-thumb', preview.imageUrl))
  }
  return card
}
