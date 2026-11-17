import { z } from 'zod'
import type { FetchFn } from '../sync/github-api'
import { getJson, HttpStatusError, sleep } from './http'
import { headingText, noteWithFrontmatter } from './markdown'
import type { Connector, ConnectorFetchInput, ConnectorNote } from './types'

/**
 * Granola meeting notes through Granola's public API (personal API key,
 * created in the Granola desktop app under Settings → Connectors → API keys),
 * one note per meeting holding Granola's AI summary. The API lists only notes
 * whose summary is ready, so a meeting lands once it is complete and is never
 * rewritten afterwards: what the user adds to the note in Kore stays theirs.
 *
 * Where notes land is the user's path pattern (`{date} {title}` by default,
 * with `{month}` and `{year}` for folders). The id key, `granola_id`, is the
 * one other Granola syncs (the `granola-sync` Obsidian plugin) write, so a
 * meeting already in the vault is recognized wherever it sits.
 *
 * API reference: https://docs.granola.ai/introduction
 */

const API_BASE = 'https://public-api.granola.ai/v1'

/** The API's page-size ceiling. */
const PAGE_SIZE = 30

/** Spacing between requests, under the API's 5 requests/second sustained rate. */
const REQUEST_SPACING_MS = 250

const listPageSchema = z.object({
  notes: z.array(z.object({ id: z.string() })),
  hasMore: z.boolean().nullish(),
  cursor: z.string().nullish(),
})

const personSchema = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
})

const transcriptLineSchema = z.object({
  speaker: z
    .object({
      source: z.string().nullish(),
      attribution: z.string().nullish(),
      name: z.string().nullish(),
    })
    .nullish(),
  text: z.string(),
  start_time: z.string().nullish(),
})

const noteSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  created_at: z.string(),
  web_url: z.string().nullish(),
  calendar_event: z.object({ scheduled_start_time: z.string().nullish() }).nullish(),
  attendees: z.array(personSchema).nullish(),
  folder_membership: z.array(z.object({ name: z.string() })).nullish(),
  summary_markdown: z.string().nullish(),
  summary_text: z.string().nullish(),
  private_notes_markdown: z.string().nullish(),
  private_notes_text: z.string().nullish(),
  transcript: z.array(transcriptLineSchema).nullish(),
})

const transcriptSchema = z.union([
  z.array(transcriptLineSchema),
  z.object({ transcript: z.array(transcriptLineSchema).nullish() }),
])

/** One Granola meeting note as the API returns it. */
export type GranolaNote = z.infer<typeof noteSchema>

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The meeting's local calendar date (`YYYY-MM-DD`), or `null` for a bad timestamp. */
function localDate(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The local `HH:MM` of `iso`, or `null` for a bad timestamp. */
function localTime(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** When the meeting was: the calendar start, else when the note was made. */
function meetingStart(note: GranolaNote): string {
  return note.calendar_event?.scheduled_start_time ?? note.created_at
}

function folderNames(note: GranolaNote): string[] {
  return Array.from(
    new Set((note.folder_membership ?? []).map((folder) => folder.name.trim())),
  ).filter((name) => name !== '')
}

function speakerLabel(line: z.infer<typeof transcriptLineSchema>): string {
  const name = line.speaker?.name?.trim()
  if (name) {
    return name
  }
  if (line.speaker?.attribution === 'me' || line.speaker?.source === 'microphone') {
    return 'Me'
  }
  return 'Them'
}

/** The transcript as paragraphs, one per speaker turn; `null` when empty. */
export function renderGranolaTranscript(
  lines: readonly z.infer<typeof transcriptLineSchema>[],
): string | null {
  const turns: { speaker: string; text: string[] }[] = []
  for (const line of lines) {
    const text = line.text.trim()
    if (text === '') {
      continue
    }
    const speaker = speakerLabel(line)
    const last = turns.at(-1)
    if (last?.speaker === speaker) {
      last.text.push(text)
    } else {
      turns.push({ speaker, text: [text] })
    }
  }
  if (turns.length === 0) {
    return null
  }
  return turns.map((turn) => `**${turn.speaker}:** ${turn.text.join(' ')}`).join('\n\n')
}

function attendeeNames(note: GranolaNote): string[] {
  const names = (note.attendees ?? []).flatMap((person) => {
    const name = person.name?.trim() || person.email?.trim()
    return name ? [name] : []
  })
  return Array.from(new Set(names))
}

/** The summary body, or `null` while Granola has none for this meeting. */
function summaryBody(note: GranolaNote): string | null {
  const summary = (note.summary_markdown ?? note.summary_text ?? '').trim()
  return summary === '' ? null : summary
}

/** What to write besides the summary (the connector's options). */
export interface GranolaContent {
  readonly privateNotes: boolean
  readonly transcript: boolean
}

const SUMMARY_ONLY: GranolaContent = { privateNotes: false, transcript: false }

/** The full markdown for a meeting note; `null` when it has no summary yet. */
export function renderGranolaNote(
  note: GranolaNote,
  tags: readonly string[],
  content: GranolaContent = SUMMARY_ONLY,
): string | null {
  const summary = summaryBody(note)
  if (summary === null) {
    return null
  }
  const title = headingText(note.title ?? '') || 'Untitled meeting'
  const start = meetingStart(note)
  const sections = [`# ${title}`, summary]
  const privateNotes = (note.private_notes_markdown ?? note.private_notes_text ?? '').trim()
  if (content.privateNotes && privateNotes !== '') {
    sections.push('## My notes', privateNotes)
  }
  const transcript = content.transcript ? renderGranolaTranscript(note.transcript ?? []) : null
  if (transcript !== null) {
    sections.push('## Transcript', transcript)
  }
  return noteWithFrontmatter(
    {
      title,
      granola_id: note.id,
      date: localDate(start) ?? undefined,
      time: localTime(start) ?? undefined,
      attendees: attendeeNames(note),
      granola_folders: folderNames(note),
      granola_url: note.web_url ?? undefined,
      tags: [...tags],
    },
    `${sections.join('\n\n')}\n`,
  )
}

function meetingNote(
  note: GranolaNote,
  tags: readonly string[],
  content: GranolaContent,
): ConnectorNote | null {
  const source = renderGranolaNote(note, tags, content)
  if (source === null) {
    return null
  }
  const start = meetingStart(note)
  const date = localDate(start)
  const time = localTime(start)
  const title = headingText(note.title ?? '') || 'Untitled meeting'
  return {
    sourceId: note.id,
    title,
    fields: {
      title,
      date: date ?? '',
      time: time?.replace(':', '.') ?? '',
      month: date?.slice(0, 7) ?? '',
      year: date?.slice(0, 4) ?? '',
      folder: folderNames(note)[0] ?? '',
    },
    ...(date === null ? {} : { day: { date, time } }),
    source,
    merge: () => null,
  }
}

async function verify(token: string, fetchFn: FetchFn): Promise<void> {
  await getJson(
    fetchFn,
    `${API_BASE}/notes?page_size=1`,
    authHeaders(token),
    listPageSchema,
    'Granola',
  )
}

/**
 * One meeting's detail, with its transcript when asked. A transcript too
 * large to inline (HTTP 413) comes from its own endpoint instead.
 */
async function fetchNote(
  input: ConnectorFetchInput,
  id: string,
  withTranscript: boolean,
): Promise<GranolaNote> {
  const url = `${API_BASE}/notes/${encodeURIComponent(id)}`
  const headers = authHeaders(input.token)
  if (!withTranscript) {
    return await getJson(input.fetchFn, url, headers, noteSchema, 'Granola note')
  }
  try {
    return await getJson(
      input.fetchFn,
      `${url}?include=transcript`,
      headers,
      noteSchema,
      'Granola note',
    )
  } catch (cause) {
    if (!(cause instanceof HttpStatusError) || cause.status !== 413) {
      throw cause
    }
  }
  const note = await getJson(input.fetchFn, url, headers, noteSchema, 'Granola note')
  await sleep(REQUEST_SPACING_MS)
  const transcript = await getJson(
    input.fetchFn,
    `${url}/transcript`,
    headers,
    transcriptSchema,
    'Granola transcript',
  )
  return { ...note, transcript: Array.isArray(transcript) ? transcript : transcript.transcript }
}

async function* fetchNotes(input: ConnectorFetchInput): AsyncIterable<ConnectorNote> {
  const content: GranolaContent = {
    privateNotes: input.options['privateNotes'] === true,
    transcript: input.options['transcript'] === true,
  }
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) })
    if (input.since !== null) {
      params.set('created_after', input.since.toISOString())
    }
    if (cursor !== null) {
      params.set('cursor', cursor)
    }
    const page = await getJson(
      input.fetchFn,
      `${API_BASE}/notes?${params.toString()}`,
      authHeaders(input.token),
      listPageSchema,
      'Granola notes',
    )
    for (const listed of page.notes) {
      if (input.isStale()) {
        return
      }
      // Meeting notes are written once, so a known meeting needs no detail fetch.
      if (await input.hasNote(listed.id)) {
        continue
      }
      await sleep(REQUEST_SPACING_MS)
      const note = await fetchNote(input, listed.id, content.transcript)
      const rendered = meetingNote(note, input.tags, content)
      if (rendered !== null) {
        yield rendered
      }
    }
    cursor = page.hasMore === true && page.cursor ? page.cursor : null
  } while (cursor !== null && !input.isStale())
}

/** The Granola connector. */
export const granolaConnector: Connector = {
  id: 'granola',
  label: 'Granola',
  description: 'Meeting notes with Granola’s AI summary, one note per meeting.',
  idKey: 'granola_id',
  defaultFolder: 'Granola',
  defaultPattern: '{date} {title}',
  patternFields: ['title', 'date', 'time', 'month', 'year', 'folder'],
  exampleFields: {
    title: 'Weekly sync',
    date: '2026-11-17',
    time: '09.30',
    month: '2026-11',
    year: '2026',
    folder: 'Team',
  },
  defaultTags: ['meeting'],
  options: [
    {
      key: 'privateNotes',
      label: 'My notes',
      description: 'What you typed in Granola during the meeting, under the summary.',
    },
    {
      key: 'transcript',
      label: 'Transcript',
      description: 'The full conversation at the end of the note.',
    },
  ],
  dailyHeading: 'Meetings',
  tokenUrl: 'https://docs.granola.ai/introduction',
  tokenLabel: 'API key',
  tokenNoun: 'API key',
  overlapMs: 3 * 24 * 60 * 60 * 1000,
  verify,
  fetchNotes,
}
