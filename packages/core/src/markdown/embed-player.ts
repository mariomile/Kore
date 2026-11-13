/**
 * The live player a link can offer, from the URL alone.
 *
 * An embed card for a video, a song or a design file holds a Play (or Show)
 * button; only that click loads the provider's player, so opening a note
 * never tells a third party anything. This module answers which player URL
 * the click loads, how tall its frame is, and what to call the service.
 *
 * The URL shapes and frame heights are ported from Lotion's
 * `Lotion/Editor/Embeds/EmbedProviders.swift`
 * (https://github.com/fayazara/Lotion), used under its MIT license:
 *
 *   Copyright (c) 2026 Fayaz Ahmed
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *
 *   The above copyright notice and this permission notice shall be included
 *   in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 *   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 *   USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Every player host here must also be in the desktop CSP `frame-src`
 * (`apps/desktop/src-tauri/tauri.conf.json`), or the frame stays blank.
 */

/** One provider's player for a link. */
export interface EmbedPlayer {
  /** The provider's embeddable player, loaded only on an explicit click. */
  readonly url: string
  /** The service's name, shown on the card ("Spotify"). */
  readonly provider: string
  /** Fixed frame height in CSS pixels; `null` is a 16:9 video frame. */
  readonly height: number | null
  /** A video or audio player (the button says Play) rather than a page (Show). */
  readonly playable: boolean
}

/** An id or path segment safe to put into a player URL as is. */
const SAFE_SEGMENT = /^[\w-]+$/
const DIGITS = /^\d+$/

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/** `90`, `90s`, `1m30s` or `1h2m3s` as whole seconds; null when malformed or zero. */
export function startSeconds(time: string): number | null {
  if (DIGITS.test(time)) {
    const value = Number(time)
    return value > 0 ? value : null
  }
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time)
  if (match === null) {
    return null
  }
  const [, hours = '0', minutes = '0', seconds = '0'] = match
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
  return total > 0 ? total : null
}

function youtubeId(host: string, parts: readonly string[], url: URL): string | null {
  if (host === 'youtu.be') {
    return parts[0] ?? null
  }
  if (!hostMatches(host, 'youtube.com') && host !== 'youtube-nocookie.com') {
    return null
  }
  if (parts[0] === 'watch') {
    return url.searchParams.get('v')
  }
  if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '') && parts.length > 1) {
    return parts[1] ?? null
  }
  return null
}

/**
 * YouTube resolves through `youtube-nocookie.com`, and Vimeo with `dnt=1`:
 * the player loads only on a click, so the request says the reader pressed
 * play, not that they opened a note. Autoplay is on for the same reason.
 */
function videoPlayer(host: string, parts: readonly string[], url: URL): EmbedPlayer | null {
  const youtube = youtubeId(host, parts, url)
  if (youtube !== null) {
    if (youtube.length < 6 || !SAFE_SEGMENT.test(youtube)) {
      return null
    }
    const start = startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start') ?? '')
    const player = new URL(`https://www.youtube-nocookie.com/embed/${youtube}`)
    player.searchParams.set('autoplay', '1')
    player.searchParams.set('rel', '0')
    player.searchParams.set('playsinline', '1')
    if (start !== null) {
      player.searchParams.set('start', String(start))
    }
    return { url: player.href, provider: 'YouTube', height: null, playable: true }
  }
  if (hostMatches(host, 'vimeo.com')) {
    // `vimeo.com/123`, `vimeo.com/channels/staffpicks/123`, `player.vimeo.com/video/123`.
    const id = parts.find((part) => DIGITS.test(part))
    if (id === undefined) {
      return null
    }
    return {
      url: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1`,
      provider: 'Vimeo',
      height: null,
      playable: true,
    }
  }
  if (hostMatches(host, 'loom.com') && ['share', 'embed'].includes(parts[0] ?? '')) {
    const id = parts[1]
    if (id === undefined || !SAFE_SEGMENT.test(id)) {
      return null
    }
    return {
      url: `https://www.loom.com/embed/${id}?autoplay=1&hide_owner=true`,
      provider: 'Loom',
      height: null,
      playable: true,
    }
  }
  return null
}

const SPOTIFY_TYPES = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist'])

function audioPlayer(host: string, parts: readonly string[], url: URL): EmbedPlayer | null {
  if (host === 'open.spotify.com') {
    // `open.spotify.com/intl-it/track/…` is the same track as `/track/…`.
    const rest = parts[0]?.startsWith('intl-') === true ? parts.slice(1) : parts
    const [type = '', id = ''] = rest
    if (!SPOTIFY_TYPES.has(type) || !/^[a-z0-9]+$/i.test(id)) {
      return null
    }
    const single = type === 'track' || type === 'episode'
    return {
      url: `https://open.spotify.com/embed/${type}/${id}`,
      provider: 'Spotify',
      height: single ? 152 : 352,
      playable: true,
    }
  }
  if (host === 'music.apple.com' || host === 'podcasts.apple.com') {
    // `/us/album/name/123?i=456`: a storefront, a type, then the item.
    if (parts.length < 3) {
      return null
    }
    const player = new URL(url.href)
    player.protocol = 'https:'
    player.hostname = `embed.${host}`
    player.hash = ''
    const single = url.searchParams.has('i') || parts.includes('song')
    return {
      url: player.href,
      provider: host === 'music.apple.com' ? 'Apple Music' : 'Apple Podcasts',
      height: single ? 175 : 450,
      playable: true,
    }
  }
  return null
}

const FIGMA_TYPES = new Set(['file', 'design', 'proto', 'board', 'slides'])
const CODEPEN_VIEWS = new Set(['pen', 'full', 'details'])

function pagePlayer(host: string, parts: readonly string[], url: URL): EmbedPlayer | null {
  if (hostMatches(host, 'figma.com') && FIGMA_TYPES.has(parts[0] ?? '') && parts.length > 1) {
    const player = new URL('https://www.figma.com/embed')
    player.searchParams.set('embed_host', 'kore')
    player.searchParams.set('url', url.href)
    return { url: player.href, provider: 'Figma', height: 450, playable: false }
  }
  if (host === 'codepen.io') {
    // `/user/pen/id`, or `/team/name/pen/id` for a team's pen.
    const team = parts[0] === 'team'
    const rest = team ? parts.slice(1) : parts
    const [owner = '', view = '', id = ''] = rest
    if (!CODEPEN_VIEWS.has(view) || !SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(id)) {
      return null
    }
    return {
      url: `https://codepen.io/${team ? `team/${owner}` : owner}/embed/${id}?default-tab=result`,
      provider: 'CodePen',
      height: 400,
      playable: false,
    }
  }
  return null
}

/**
 * The player `url` can offer behind a click, or `null` when the link has no
 * known embeddable player (it stays a plain card). Only https and http links
 * qualify; ids are checked before they reach a player URL.
 */
export function embedPlayer(url: string): EmbedPlayer | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const parts = parsed.pathname.split('/').filter(Boolean)
  return (
    videoPlayer(host, parts, parsed) ??
    audioPlayer(host, parts, parsed) ??
    pagePlayer(host, parts, parsed)
  )
}
