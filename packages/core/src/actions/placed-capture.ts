import { writeNote } from '../graph/commands'
import { createNoteWithSource, newNoteSource } from '../graph/create-note'
import { dailyPath, isNotePath, isSafeVisibleGraphPath, noteFileStem } from '../graph/paths'
import { appendBlock, appendBlockUnderBacklinkedHeading, wikiLinkSafe } from '../markdown/edit'
import { formatEmbedBlock } from '../markdown/embed-block'
import { linkKind } from '../markdown/link-kind'
import { ensureBacklinkTarget } from './backlink-target'
import { captureLocalDate } from './capture-identity'
import type { CaptureEnvelope, CaptureLook } from './capture-envelope'
import { displayTitle, localNoteSource, readNoteUnlessMissing } from './capture-note'
import { fetchLinkText } from './link-text'
import { xPostId } from './link-preview-providers'
import { resolveXPostEmbed } from './post-embed'

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

/**
 * The words a `text` capture quotes: the text the user selected, else what
 * the page holds (an X post's text, an article, a video's transcript), else
 * the page's own description. Best-effort: a network failure falls back to
 * what the envelope carried, so the save itself never waits on a fetch.
 */
async function capturedWords(envelope: CaptureEnvelope): Promise<string | null> {
  const selection = envelope.selection?.trim()
  if (selection) {
    return selection
  }
  try {
    if (xPostId(envelope.url) !== null) {
      const post = await resolveXPostEmbed(envelope.url)
      const words = post?.body
        .map((segment) => segment.text)
        .join('')
        .trim()
      if (post !== undefined && words) {
        const author = post.author.name.trim() || `@${post.author.handle}`
        return `${words}\n\n— ${markdownLink(envelope.url, author)}`
      }
    } else {
      const text = await fetchLinkText(envelope.url)
      if (text !== null) {
        return bounded(text.markdown)
      }
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
export async function placedCaptureBlock(envelope: CaptureEnvelope): Promise<string> {
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
      const isPost = xPostId(envelope.url) !== null
      parts.push(isPost ? markdownLink(envelope.url, title) : envelope.url)
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

/**
 * Write one placed capture into its destination. Today's daily note gets it
 * at the end of its Links section; an existing note at its end; a new note
 * is created with it (and today's daily links to the new note). A
 * destination note that no longer exists falls back to the daily note. A
 * destination that already holds the URL is left untouched.
 */
export async function drainPlacedCapture(
  envelope: CaptureEnvelope,
  generation: number,
): Promise<PlacedCaptureOutcome> {
  const destination = envelope.destination ?? { kind: 'daily' }
  const daily = dailyPath(captureLocalDate(new Date(envelope.capturedAt)))

  if (destination.kind === 'note' && isNotePath(destination.path)) {
    const source = await readNoteUnlessMissing(destination.path, generation)
    if (source !== null) {
      if (source.includes(envelope.url)) {
        return { path: destination.path, duplicate: true }
      }
      const block = await placedCaptureBlock(envelope)
      await writeNote(destination.path, appendBlock(source, block), generation)
      return { path: destination.path, duplicate: false }
    }
  }

  const linksTitle = await ensureBacklinkTarget(LINKS_NOTE_TITLE, generation)
  const dailySource = await localNoteSource(daily, generation)

  if (destination.kind === 'new') {
    const title = wikiLinkSafe(destination.title) || displayTitle(envelope)
    const block = await placedCaptureBlock(envelope)
    const path = await createNoteWithSource(
      title,
      newNoteSource(title, block),
      generation,
      safeFolder(destination.folder),
    )
    const reference = `[[${noteFileStem(path)}|${title}]]`
    await writeNote(
      daily,
      appendBlockUnderBacklinkedHeading(dailySource, linksTitle, reference, [LINKS_NOTE_TITLE]),
      generation,
    )
    return { path, duplicate: false }
  }

  if (dailySource.includes(envelope.url)) {
    return { path: daily, duplicate: true }
  }
  const block = await placedCaptureBlock(envelope)
  await writeNote(
    daily,
    appendBlockUnderBacklinkedHeading(dailySource, linksTitle, block, [LINKS_NOTE_TITLE]),
    generation,
  )
  return { path: daily, duplicate: false }
}
