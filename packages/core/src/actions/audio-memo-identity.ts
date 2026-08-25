import { AUDIO_EXTENSION_BY_MIME, baseMimeType } from '../ai/transcribe'
import { audioMemoPath, dailyPath, notePath } from '../graph/paths'

/**
 * Audio-memo naming: everything derivable from a recording's stored path —
 * the shared basename, its timestamp-derived titles, and the segment (`part`)
 * suffix scheme. See the `audio-memo` module doc for the full pipeline.
 */

/** Everything derivable from a memo's shared basename. */
export interface AudioMemoIdentity {
  /**
   * The shared basename, e.g. `audio-memo-2026-06-11-153022-845` — also the
   * daily-note wikilink target, resolvable through the transcription note's
   * frontmatter alias.
   */
  base: string
  /** Local ISO day it was recorded — the daily note that backlinks it. */
  date: string
  /** The timestamp fallback title, before the transcript-derived name exists. */
  title: string
  /** Timestamp fallback alias for the daily-note link, e.g. `Audio memo 15:30`. */
  alias: string
  /** Graph-relative path of the recording under `audio-memos/`. */
  audioPath: string
  /** Graph-relative path of the transcription note, `notes/<base>.md`. */
  notePath: string
  /** The recording's MIME type, as stored (derived from the extension). */
  mimeType: string
}

/** `audio/mp4` ← `m4a` etc. — the inverse of the storage-naming map. */
const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(AUDIO_EXTENSION_BY_MIME).map(([mime, extension]) => [extension, mime]),
)

/**
 * `audio-memos/(audio-memo-<date>-<hhmmss>-<ms>)[.part-NNN[-end]].<ext>`.
 * Milliseconds make back-to-back recordings collision-free; the title drops
 * them. The optional `part` suffix is a session segment (see
 * `audio-memo-session`): `-end` marks the final segment of a cleanly stopped
 * session, and a legacy suffix-free file reads as a one-part closed session.
 */
const MEMO_PATH_RE =
  /^audio-memos\/(audio-memo-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})-\d{3})(?:\.part-(\d{3})(-end)?)?\.([a-z0-9]+)$/

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function buildIdentity(
  base: string,
  date: string,
  hours: string,
  minutes: string,
  seconds: string,
  extension: string,
): AudioMemoIdentity {
  return {
    base,
    date,
    title: `Audio memo ${date} ${hours}:${minutes}:${seconds}`,
    alias: `Audio memo ${hours}:${minutes}`,
    audioPath: audioMemoPath(`${base}.${extension}`),
    notePath: notePath(base),
    mimeType: MIME_BY_EXTENSION[extension] ?? 'audio/mp4',
  }
}

/** The identity a fresh recording will be stored under (local time). */
export function audioMemoIdentity(recordedAt: Date, mimeType: string): AudioMemoIdentity {
  const date = `${recordedAt.getFullYear()}-${pad(recordedAt.getMonth() + 1, 2)}-${pad(recordedAt.getDate(), 2)}`
  const hours = pad(recordedAt.getHours(), 2)
  const minutes = pad(recordedAt.getMinutes(), 2)
  const seconds = pad(recordedAt.getSeconds(), 2)
  const base = `audio-memo-${date}-${hours}${minutes}${seconds}-${pad(recordedAt.getMilliseconds(), 3)}`
  const extension = AUDIO_EXTENSION_BY_MIME[baseMimeType(mimeType)] ?? 'm4a'
  return buildIdentity(base, date, hours, minutes, seconds, extension)
}

/**
 * Recover a memo's identity from its recording path, or `null` for anything
 * that isn't a well-formed memo recording (a stray file dropped into
 * `audio-memos/` is never touched — reconciliation must not transcribe
 * arbitrary user files).
 */
export function audioMemoFromPath(path: string): AudioMemoIdentity | null {
  return audioMemoPartFromPath(path)?.memo ?? null
}

/** A parsed segment path: which session, which position, end-marked or not. */
export interface ParsedAudioMemoPart {
  memo: AudioMemoIdentity
  part: number
  end: boolean
}

/**
 * Parse a recording path into its session identity and segment position.
 * A legacy suffix-free recording is a one-part, already-ended session.
 */
export function audioMemoPartFromPath(path: string): ParsedAudioMemoPart | null {
  const match = MEMO_PATH_RE.exec(path)
  if (match === null) {
    return null
  }
  const [, base, date, hours, minutes, seconds, part, end, extension] = match
  if (
    base === undefined ||
    date === undefined ||
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    extension === undefined
  ) {
    return null
  }
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
    return null
  }
  const partNumber = part === undefined ? 1 : Number(part)
  if (partNumber < 1) {
    return null
  }
  try {
    dailyPath(date) // calendar-validates the date the same way the backlink will
  } catch {
    return null
  }
  return {
    memo: buildIdentity(base, date, hours, minutes, seconds, extension),
    part: partNumber,
    end: part === undefined ? true : end !== undefined,
  }
}

/** The stored path of one session segment, e.g. `….part-002-end.m4a`. */
export function audioMemoPartPath(memo: AudioMemoIdentity, part: number, end: boolean): string {
  const extension = memo.audioPath.slice(memo.audioPath.lastIndexOf('.') + 1)
  return audioMemoPath(`${memo.base}.part-${pad(part, 3)}${end ? '-end' : ''}.${extension}`)
}
