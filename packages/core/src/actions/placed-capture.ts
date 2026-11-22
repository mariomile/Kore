import { importRemoteImage } from '../graph/assets'
import { writeNote } from '../graph/commands'
import { createNoteWithSource, newNoteSource } from '../graph/create-note'
import { dailyPath, isNotePath, isSafeVisibleGraphPath, noteFileStem } from '../graph/paths'
import {
  appendBlock,
  appendBlockUnderBacklinkedHeading,
  insertBlockBeforeBacklinkedHeading,
  wikiLinkSafe,
} from '../markdown/edit'
import { formatEmbedBlock } from '../markdown/embed-block'
import { markdownLinkDestination } from '../markdown/link-destination'
import { linkKind } from '../markdown/link-kind'
import { ensureBacklinkTarget } from './backlink-target'
import { captureLocalDate } from './capture-identity'
import type { CaptureDestination, CaptureEnvelope, CaptureLook } from './capture-envelope'
import { displayTitle, localNoteSource, readNoteUnlessMissing } from './capture-note'
import { fetchLinkText } from './link-text'
import { xPostId } from './link-preview-providers'
import { resolveXPostEmbed } from './post-embed'
import type { XPost } from '@post-embed/types'

/**
 * Placed captures: a link the iOS share sheet shared with a chosen look and
 * destination. Unlike the capture-note flow (a note per capture, linked from
 * the daily), the link itself is written where the user asked, drawn the way
 * they asked — the same Markdown the editor's link-look menu writes, so the
 * result is indistinguishable from a link placed by hand.
 */

/** The category note a daily's shared links sit under (shared with capture notes). */
const LINKS_NOTE_TITLE = 'Links'

/** Cap on the words a `text` capture quotes; a long article is cut at a paragraph. */
const MAX_QUOTED_CHARS = 60_000

/** The look an envelope without one, or with one its link cannot draw, falls back to. */
function effectiveLook(url: string, look: CaptureLook): CaptureLook {
  if (look !== 'embed') {
    return look
  }
  const kind = linkKind(url)
  return kind === 'social' || kind === 'video' ? 'embed' : 'card'
}

/** `[Title](url)`, the title's own brackets escaped. */
export function markdownLink(url: string, title: string): string {
  return `[${title.replaceAll(/[[\]\\]/g, String.raw`\$&`)}](${url})`
}

/** `text` as a Markdown quote, one `> ` per line (blank lines kept inside it). */
function quoted(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
}

function bounded(text: string): string {
  if (text.length <= MAX_QUOTED_CHARS) return text
  const cut = text.lastIndexOf('\n\n', MAX_QUOTED_CHARS)
  return `${text.slice(0, cut > 0 ? cut : MAX_QUOTED_CHARS)}\n\n…`
}

/** The `@handle` an `x.com/<handle>/status/<id>` link names (`null` for `/i/status/…`). */
function urlHandle(url: string): string | null {
  const handle = new URL(url).pathname.split('/')[1] ?? ''
  return handle === '' || handle === 'i' ? null : handle
}

/** The post's words with its links kept as Markdown links. */
function postWords(post: XPost): string {
  return post.body
    .map((segment) =>
      segment.type === 'link' && segment.url !== segment.text
        ? markdownLink(segment.url, segment.text)
        : segment.text,
    )
    .join('')
    .trim()
}

/** The file extension X serves a photo as: the URL's own, else its `format` parameter. */
function postImageExtension(url: string): string {
  const parsed = new URL(url)
  const named = /\.(jpe?g|png|webp|gif)$/i.exec(parsed.pathname)?.[1]
  return (named ?? parsed.searchParams.get('format') ?? 'jpg').toLowerCase()
}

/**
 * A post's picture kept in the vault's attachment folder as `name`, so the
 * card reads offline and after X drops the picture; `null` when it cannot be
 * fetched now.
 */
async function keptPostImage(
  url: string,
  name: string,
  generation: number,
): Promise<string | null> {
  try {
    return await importRemoteImage(url, name, generation)
  } catch {
    return null
  }
}

/** X serves a profile picture at 48px by default; this is the size a card draws sharp. */
function largeAvatar(url: string): string {
  return url.replace(/_normal(\.\w+)$/, '_200x200$1')
}

const POST_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** `21 Nov 2026`, or null for a post with no readable date. */
function postDay(iso: string): string | null {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : POST_DATE.format(time)
}

/**
 * Who wrote the post and when, as the pieces of one Markdown line: the
 * profile picture (kept in the vault as `x-avatar-<handle>`, 40px wide where
 * a reader honours `|40`), the name, the handle linked to the profile, and
 * the day linked to the post itself, as X does.
 */
async function postByline(post: XPost, url: string, generation: number): Promise<string[]> {
  const { name, handle, avatar } = post.author
  const picture =
    avatar === undefined
      ? null
      : await keptPostImage(
          largeAvatar(avatar),
          `x-avatar-${handle}.${postImageExtension(avatar)}`,
          generation,
        )
  const displayName = name.trim().replaceAll(/[\\*_`[\]]/g, String.raw`\$&`)
  return [
    ...(picture === null ? [] : [`![|40](${markdownLinkDestination(picture)})`]),
    ...(displayName === '' ? [] : [`**${displayName}**`]),
    markdownLink(`https://x.com/${handle}`, `@${handle}`),
    markdownLink(url, postDay(post.createdAt) ?? 'Post on X'),
  ]
}

/** The note every shared X post links to, so its backlinks list the posts. */
const X_POSTS_NOTE_TITLE = 'X posts'

/**
 * An X post as a plain Markdown card any Markdown reader (Obsidian, an
 * agent, `cat`) shows as the post: a list item whose line says who wrote it
 * and when ({@link postByline}) and links the [[X posts]] note; under it,
 * quoted, what they wrote and the photos (a video by its poster), each kept
 * in the vault, then the user's own note. A list item, not a bare quote,
 * because a backlink's context is the whole item: the X posts note then
 * shows each post in full. Offline or for a post that is gone, the card is
 * the link alone, so the save never waits on X and never loses the link.
 */
async function postCard(envelope: CaptureEnvelope, generation: number): Promise<string> {
  let post: XPost | undefined
  try {
    post = await resolveXPostEmbed(envelope.url)
  } catch {
    post = undefined
  }
  const handle = urlHandle(envelope.url)
  const byline = post
    ? await postByline(post, envelope.url, generation)
    : [markdownLink(envelope.url, handle ? `@${handle}` : 'Post on X')]
  const postsNote = await ensureBacklinkTarget(X_POSTS_NOTE_TITLE, generation)
  const quote: string[] = []
  const words = envelope.selection?.trim() || (post ? postWords(post) : '')
  if (words) {
    quote.push(words)
  }
  const images = (post?.media ?? []).flatMap((media) => {
    const image = media.type === 'photo' ? media.url : media.poster
    return image && media.unavailable !== true ? [image] : []
  })
  const postId = xPostId(envelope.url)
  const kept = await Promise.all(
    images.map(
      async (image, index) =>
        (await keptPostImage(
          image,
          `x-${postId ?? 'post'}-${index + 1}.${postImageExtension(image)}`,
          generation,
        )) ?? image,
    ),
  )
  quote.push(...kept.map((image) => `![](${markdownLinkDestination(image)})`))
  const children = quote.length > 0 ? [quoted(quote.join('\n\n'))] : []
  const note = envelope.note?.trim()
  if (note) {
    children.push(note)
  }
  const head = `- ${[...byline, `[[${postsNote}]]`].join(' ')}`
  const body = children.join('\n\n').replaceAll(/^(?=.)/gm, '  ')
  return body === '' ? head : `${head}\n${body}`
}

/**
 * The words a `text` capture of a page quotes: the text the user selected,
 * else what the page holds (an article, a video's transcript), else the
 * page's own description. Best-effort: a network failure falls back to what
 * the envelope carried, so the save itself never waits on a fetch.
 */
async function capturedWords(envelope: CaptureEnvelope): Promise<string | null> {
  const selection = envelope.selection?.trim()
  if (selection) {
    return selection
  }
  try {
    const text = await fetchLinkText(envelope.url)
    if (text !== null) {
      return bounded(text.markdown)
    }
  } catch {
    // Offline, blocked, or a page with nothing readable: keep what we have.
  }
  return envelope.metaDescription?.trim() || null
}

/**
 * The Markdown block one placed capture writes: the link in its look, then
 * the user's own note (the share sheet's "add a thought") as a paragraph.
 */
export async function placedCaptureBlock(
  envelope: CaptureEnvelope,
  generation: number,
): Promise<string> {
  const look = effectiveLook(envelope.url, envelope.look ?? 'card')
  const title = displayTitle(envelope)
  const parts: string[] = []
  switch (look) {
    case 'link':
      parts.push(markdownLink(envelope.url, title))
      break
    case 'card':
      parts.push(envelope.url)
      break
    case 'compact':
    case 'large':
      parts.push(
        formatEmbedBlock({
          kind: 'url',
          url: envelope.url,
          linkKind: linkKind(envelope.url),
          layout: look,
        }),
      )
      break
    case 'embed':
      parts.push(`![](${envelope.url})`)
      break
    case 'text': {
      if (xPostId(envelope.url) !== null) {
        // The card carries the user's note inside its own list item.
        return await postCard(envelope, generation)
      }
      parts.push(envelope.url)
      const words = await capturedWords(envelope)
      if (words !== null) {
        parts.push(quoted(words))
      }
      break
    }
  }
  const note = envelope.note?.trim()
  if (note) {
    parts.push(note)
  }
  return parts.join('\n\n')
}

/** A graph-relative folder the drain may create a note in, or `null` for the vault's default. */
function safeFolder(folder: string): string | null {
  const trimmed = folder.trim().replaceAll(/^\/+|\/+$/g, '')
  if (trimmed === '') {
    return ''
  }
  return isSafeVisibleGraphPath(trimmed) ? trimmed : null
}

/** What one placed capture did. */
export interface PlacedCaptureOutcome {
  /** The note the link was written into. */
  readonly path: string
  /** The destination already held this link, so nothing was written. */
  readonly duplicate: boolean
}

/** Where a capture lands in today's daily note. */
export type DailySpot =
  /** At the end of the daily's Links section, which it creates when missing. */
  | 'links'
  /** In the daily's own body, above its Links section (photos, PDFs). */
  | 'body'

/** One block to write where the share sheet's "Where" choice says. */
export interface Placement {
  readonly destination: CaptureDestination | undefined
  /** When the share happened: decides which daily note is "today". */
  readonly capturedAt: string
  /** What a new note is named when its destination carries no title of its own. */
  readonly title: string
  readonly dailySpot: DailySpot
  /** Text whose presence means the destination already holds this capture (a URL). */
  readonly identity?: string
  /** The block itself, built only once the capture is known to be written. */
  readonly block: () => Promise<string>
}

function writeIntoDaily(
  source: string,
  block: string,
  spot: DailySpot,
  linksTitle: string,
): string {
  return spot === 'links'
    ? appendBlockUnderBacklinkedHeading(source, linksTitle, block, [LINKS_NOTE_TITLE])
    : insertBlockBeforeBacklinkedHeading(source, [linksTitle, LINKS_NOTE_TITLE], block)
}

/**
 * Write one block into its destination. Today's daily note gets it in its
 * {@link DailySpot}; an existing note at its end; a new note is created with
 * it (and today's daily links to the new note, in the same spot). A
 * destination note that no longer exists falls back to the daily note. A
 * destination that already holds the capture's identity is left untouched.
 */
export async function placeCapture(
  placement: Placement,
  generation: number,
): Promise<PlacedCaptureOutcome> {
  const destination = placement.destination ?? { kind: 'daily' }
  const daily = dailyPath(captureLocalDate(new Date(placement.capturedAt)))
  const holds = (source: string): boolean =>
    placement.identity !== undefined && source.includes(placement.identity)

  if (destination.kind === 'note' && isNotePath(destination.path)) {
    const source = await readNoteUnlessMissing(destination.path, generation)
    if (source !== null) {
      if (holds(source)) {
        return { path: destination.path, duplicate: true }
      }
      await writeNote(destination.path, appendBlock(source, await placement.block()), generation)
      return { path: destination.path, duplicate: false }
    }
  }

  // Only the Links spot needs the category note; a photo must not create it
  // as a side effect.
  const linksTitle =
    placement.dailySpot === 'links'
      ? await ensureBacklinkTarget(LINKS_NOTE_TITLE, generation)
      : LINKS_NOTE_TITLE
  const dailySource = await localNoteSource(daily, generation)

  if (destination.kind === 'new') {
    const title = wikiLinkSafe(destination.title) || placement.title
    const path = await createNoteWithSource(
      title,
      newNoteSource(title, await placement.block()),
      generation,
      safeFolder(destination.folder),
    )
    const reference = `[[${noteFileStem(path)}|${title}]]`
    await writeNote(
      daily,
      writeIntoDaily(dailySource, reference, placement.dailySpot, linksTitle),
      generation,
    )
    return { path, duplicate: false }
  }

  if (holds(dailySource)) {
    return { path: daily, duplicate: true }
  }
  await writeNote(
    daily,
    writeIntoDaily(dailySource, await placement.block(), placement.dailySpot, linksTitle),
    generation,
  )
  return { path: daily, duplicate: false }
}

/**
 * Write one shared link where the share sheet said: in the daily, under its
 * Links section, posts included.
 */
export async function drainPlacedCapture(
  envelope: CaptureEnvelope,
  generation: number,
): Promise<PlacedCaptureOutcome> {
  return await placeCapture(
    {
      destination: envelope.destination,
      capturedAt: envelope.capturedAt,
      title: displayTitle(envelope),
      dailySpot: 'links',
      identity: envelope.url,
      block: async () => await placedCaptureBlock(envelope, generation),
    },
    generation,
  )
}
