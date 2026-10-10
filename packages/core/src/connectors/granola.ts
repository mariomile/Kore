import { z } from 'zod'
import type { FetchFn } from '../sync/github-api'
import { getJson, sleep } from './http'
import { connectorFileStem, headingText, noteWithFrontmatter } from './markdown'
import type { Connector, ConnectorFetchInput, ConnectorNote } from './types'

/**
 * Granola meeting notes through Granola's public API (personal API key,
 * created in the Granola desktop app under Settings → Connectors → API keys),
 * one note per meeting holding Granola's AI summary. The API lists only notes
 * whose summary is ready, so a meeting lands once it is complete and is never
 * rewritten afterwards: what the user adds to the note in Kore stays theirs.
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

const noteSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  created_at: z.string(),
  attendees: z.array(personSchema).nullish(),
  summary_markdown: z.string().nullish(),
  summary_text: z.string().nullish(),
})

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

/** The full markdown for a meeting note; `null` when it has no summary yet. */
export function renderGranolaNote(note: GranolaNote): string | null {
  const summary = summaryBody(note)
  if (summary === null) {
    return null
  }
  const title = headingText(note.title ?? '') || 'Untitled meeting'
  return noteWithFrontmatter(
    {
      granola_id: note.id,
      date: localDate(note.created_at) ?? undefined,
      attendees: attendeeNames(note),
      tags: ['meeting'],
    },
    `# ${title}\n\n${summary}\n`,
  )
}

function meetingNote(note: GranolaNote): ConnectorNote | null {
  const source = renderGranolaNote(note)
  if (source === null) {
    return null
  }
  const date = localDate(note.created_at)
  const title = headingText(note.title ?? '') || 'Untitled meeting'
  return {
    sourceId: note.id,
    fileStem: connectorFileStem(date === null ? title : `${date} ${title}`, note.id),
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

async function* fetchNotes(input: ConnectorFetchInput): AsyncIterable<ConnectorNote> {
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
      const note = await getJson(
        input.fetchFn,
        `${API_BASE}/notes/${encodeURIComponent(listed.id)}`,
        authHeaders(input.token),
        noteSchema,
        'Granola note',
      )
      const rendered = meetingNote(note)
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
  tokenUrl: 'https://docs.granola.ai/introduction',
  tokenLabel: 'API key',
  overlapMs: 3 * 24 * 60 * 60 * 1000,
  verify,
  fetchNotes,
}
