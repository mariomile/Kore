import { embedPlayer, type EmbedPlayer } from './embed-player'

/**
 * A raw `<iframe>` pasted into a note, the way Obsidian notes and a site's
 * "Embed" button carry a map, a chart or a form. The markdown keeps the tag
 * as written (Obsidian renders it); Kore draws it as a card that loads the
 * frame only when asked, sandboxed like every other player.
 */
export interface IframeEmbed {
  /** What the card's Play (or Show) loads. */
  readonly player: EmbedPlayer
  /** The frame's own `title`, or null when it has none. */
  readonly title: string | null
}

const IFRAME = /^<iframe\b([^>]*)>\s*<\/iframe>$/i
/** The largest fixed height a pasted frame keeps; taller ones stay 16:9. */
const MAX_HEIGHT = 1200

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? null : decodeEntities(value.trim())
}

function decodeEntities(value: string): string {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
}

function pixelHeight(value: string | null): number | null {
  if (value === null || !/^\d+(?:px)?$/i.test(value)) {
    return null
  }
  const height = Number.parseInt(value, 10)
  return height > 0 && height <= MAX_HEIGHT ? height : null
}

/**
 * The embed a block of text is, or null. Only a block that is one iframe
 * qualifies, and only one that loads an https page: anything else (a
 * script, an `http:` or `javascript:` source) stays text.
 */
export function parseIframeEmbed(text: string): IframeEmbed | null {
  const match = IFRAME.exec(text.trim())
  const attrs = match?.[1]
  if (attrs === undefined) {
    return null
  }
  const src = attribute(attrs, 'src')
  let url: URL
  try {
    url = new URL(src ?? '')
  } catch {
    return null
  }
  if (url.protocol !== 'https:') {
    return null
  }
  const title = attribute(attrs, 'title')
  // A known provider's frame (a YouTube embed copied from its Share menu)
  // gets that provider's own player and name.
  const known = embedPlayer(url.href)
  const player: EmbedPlayer = known ?? {
    url: url.href,
    provider: url.hostname.replace(/^www\./, ''),
    height: pixelHeight(attribute(attrs, 'height')),
    playable: false,
  }
  return { player, title: title === '' ? null : title }
}
