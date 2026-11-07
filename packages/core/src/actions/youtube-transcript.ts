import { z } from 'zod'
import { captureDataFetch } from '../graph/commands'

/**
 * YouTube transcripts for pasted video links. The Android player API answers
 * a video's caption tracks with URLs that serve without a browser session
 * (the web player's own track URLs now need a proof-of-origin token), the
 * same route the `youtube-transcript-api` Python package takes. Both requests
 * go through the bounded Rust `capture_data_fetch` primitive.
 */

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const PLAYER_CLIENT = { clientName: 'ANDROID', clientVersion: '20.10.38' } as const

const captionTrackSchema = z.object({
  baseUrl: z.string(),
  languageCode: z.string(),
  kind: z.string().optional(),
  name: z
    .object({
      simpleText: z.string().optional(),
      runs: z.array(z.object({ text: z.string() })).optional(),
    })
    .optional(),
})

const playerAnswerSchema = z.object({
  playabilityStatus: z.object({ status: z.string() }).optional(),
  videoDetails: z.object({ title: z.string().optional() }).optional(),
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z
        .object({ captionTracks: z.array(captionTrackSchema).optional() })
        .optional(),
    })
    .optional(),
})

type CaptionTrack = z.infer<typeof captionTrackSchema>

/** One video's transcript, ready to save as Markdown. */
export interface YouTubeTranscript {
  /** The video's title, from the player answer. */
  readonly title: string | null
  /** The caption track's label, e.g. `English (auto-generated)`. */
  readonly trackName: string
  /** Timestamped paragraphs, one per minute of speech. */
  readonly markdown: string
}

/**
 * The track that reads closest to what is said: a human-made track in the
 * spoken language (the language of the auto-generated track), else the
 * auto-generated track itself, else the first human-made one.
 */
export function pickCaptionTrack(tracks: readonly CaptionTrack[]): CaptionTrack | null {
  const generated = tracks.find((track) => track.kind === 'asr')
  const written = tracks.filter((track) => track.kind !== 'asr')
  if (generated !== undefined) {
    return written.find((track) => track.languageCode === generated.languageCode) ?? generated
  }
  return written[0] ?? null
}

function trackName(track: CaptionTrack): string {
  const name = track.name?.simpleText ?? track.name?.runs?.map((run) => run.text).join('') ?? ''
  return name.trim() === '' ? track.languageCode : name.trim()
}

function timestamp(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** Caption text arrives entity-escaped inside the XML (`&amp;#39;`); decode the inner layer. */
function decodeCaption(text: string): string {
  const decoded = new DOMParser().parseFromString(text, 'text/html').documentElement.textContent
  return decoded.replaceAll(/\s+/g, ' ').trim()
}

interface CaptionLine {
  readonly start: number
  readonly text: string
}

/**
 * Parse a timed-text document — the classic `<text start dur>` format or
 * srv3's `<p t d>` (milliseconds) — into timed lines.
 */
export function parseTimedText(xml: string): CaptionLine[] {
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const lines: CaptionLine[] = [
    ...Array.from(document.querySelectorAll('text'), (element) => ({
      start: Number(element.getAttribute('start') ?? 0),
      text: decodeCaption(element.textContent),
    })),
    ...Array.from(document.querySelectorAll('p[t]'), (element) => ({
      start: Number(element.getAttribute('t') ?? 0) / 1000,
      text: decodeCaption(element.textContent),
    })),
  ]
  return lines.filter((line) => line.text !== '' && Number.isFinite(line.start))
}

/** Join timed lines into one paragraph per minute, each led by its timestamp. */
export function transcriptMarkdown(lines: readonly CaptionLine[]): string {
  const paragraphs: string[] = []
  let current: { start: number; words: string[] } | null = null
  for (const line of lines) {
    if (current === null || line.start - current.start >= 60) {
      if (current !== null)
        paragraphs.push(`[${timestamp(current.start)}] ${current.words.join(' ')}`)
      current = { start: line.start, words: [] }
    }
    current.words.push(line.text)
  }
  if (current !== null) paragraphs.push(`[${timestamp(current.start)}] ${current.words.join(' ')}`)
  return paragraphs.join('\n\n')
}

/** A track URL is only followed to YouTube's own timed-text host, as srv1 XML. */
function trackUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com') return null
    url.searchParams.delete('fmt')
    return url.href
  } catch {
    return null
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Fetch one video's transcript, or `null` when the video has none (no
 * captions, unplayable, or an answer this parser does not recognize).
 * Propagates the transport's typed errors.
 */
export async function fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscript | null> {
  const answer = playerAnswerSchema.safeParse(
    parseJson(
      await captureDataFetch(
        PLAYER_URL,
        JSON.stringify({ context: { client: PLAYER_CLIENT }, videoId }),
      ),
    ),
  )
  if (!answer.success || (answer.data.playabilityStatus?.status ?? 'OK') !== 'OK') return null
  const tracks = answer.data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  const track = pickCaptionTrack(tracks)
  const url = track === null ? null : trackUrl(track.baseUrl)
  if (track === null || url === null) return null
  const markdown = transcriptMarkdown(parseTimedText(await captureDataFetch(url)))
  if (markdown === '') return null
  return {
    title: answer.data.videoDetails?.title?.trim() || null,
    trackName: trackName(track),
    markdown,
  }
}
