import { z } from 'zod'
import { ReflectError } from '../errors'
import type { FetchFn } from '../sync/github-api'
import { getJson } from './http'
import {
  appendBlock,
  connectorFileStem,
  headingText,
  indentContinuation,
  noteWithFrontmatter,
} from './markdown'
import type { Connector, ConnectorFetchInput, ConnectorNote } from './types'

/**
 * Readwise (books, articles, tweets, podcasts — everything synced to
 * Readwise) through its export API, one note per source document. A
 * highlight's identity is its `readwise.io/open/<id>` link, so a later run
 * appends only highlights the note does not already carry: edits, reordering
 * and deletions the user made stay untouched.
 *
 * API reference: https://readwise.io/api_deets
 */

const API_BASE = 'https://readwise.io/api/v2'

const tagSchema = z.object({ name: z.string() })

const highlightSchema = z.object({
  id: z.number(),
  text: z.string(),
  note: z.string().nullish(),
  location: z.number().nullish(),
  highlighted_at: z.string().nullish(),
  is_discard: z.boolean().nullish(),
  tags: z.array(tagSchema).nullish(),
})

const bookSchema = z.object({
  user_book_id: z.number(),
  title: z.string().nullish(),
  readable_title: z.string().nullish(),
  author: z.string().nullish(),
  category: z.string().nullish(),
  source_url: z.string().nullish(),
  unique_url: z.string().nullish(),
  summary: z.string().nullish(),
  book_tags: z.array(tagSchema).nullish(),
  highlights: z.array(highlightSchema),
})

const exportPageSchema = z.object({
  nextPageCursor: z.union([z.string(), z.number()]).nullish(),
  results: z.array(bookSchema),
})

/** One exported Readwise document with its highlights. */
export type ReadwiseBook = z.infer<typeof bookSchema>
type ReadwiseHighlight = z.infer<typeof highlightSchema>

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Token ${token}` }
}

/** The canonical link of one highlight — also its identity inside a note. */
export function readwiseHighlightUrl(id: number): string {
  return `https://readwise.io/open/${id}`
}

const HIGHLIGHT_LINK_RE = /readwise\.io\/open\/(\d+)/g

/** The highlight ids a note already carries. */
export function readwiseHighlightIds(source: string): Set<number> {
  return new Set(Array.from(source.matchAll(HIGHLIGHT_LINK_RE), (match) => Number(match[1])))
}

function tagSlug(name: string): string {
  return name.trim().replaceAll(/\s+/g, '-')
}

function liveHighlights(book: ReadwiseBook): ReadwiseHighlight[] {
  return book.highlights
    .filter((highlight) => highlight.is_discard !== true && highlight.text.trim() !== '')
    .sort(
      (first, second) =>
        (first.location ?? Number.MAX_SAFE_INTEGER) - (second.location ?? Number.MAX_SAFE_INTEGER),
    )
}

function renderHighlight(highlight: ReadwiseHighlight): string {
  const tags = (highlight.tags ?? []).map((tag) => ` #${tagSlug(tag.name)}`).join('')
  const lines = [
    `- ${indentContinuation(highlight.text, '  ')} ([View highlight](${readwiseHighlightUrl(highlight.id)}))${tags}`,
  ]
  const note = highlight.note?.trim()
  if (note) {
    lines.push(`  - **Note:** ${indentContinuation(note, '    ')}`)
  }
  return lines.join('\n')
}

function bookTitle(book: ReadwiseBook): string {
  return headingText(book.readable_title ?? book.title ?? '') || `Readwise ${book.user_book_id}`
}

/** The full markdown for a book's first sync. */
export function renderReadwiseBook(book: ReadwiseBook): string {
  const title = bookTitle(book)
  const url = book.source_url ?? book.unique_url ?? undefined
  const meta: string[] = []
  if (book.author) {
    meta.push(`**Author:** ${headingText(book.author)}`)
  }
  if (url) {
    meta.push(`**Source:** <${url}>`)
  }
  const sections = [`# ${title}`]
  if (meta.length > 0) {
    sections.push(...meta)
  }
  if (book.summary?.trim()) {
    sections.push(book.summary.trim())
  }
  sections.push('## Highlights', liveHighlights(book).map(renderHighlight).join('\n'))
  return noteWithFrontmatter(
    {
      readwise_id: String(book.user_book_id),
      author: book.author ?? undefined,
      category: book.category ?? undefined,
      source_url: url,
      tags: ['readwise', ...(book.book_tags ?? []).map((tag) => tagSlug(tag.name))],
    },
    `${sections.join('\n\n')}\n`,
  )
}

/** Append the highlights `existing` does not carry yet; `null` when none are new. */
export function mergeReadwiseBook(existing: string, book: ReadwiseBook): string | null {
  const known = readwiseHighlightIds(existing)
  const fresh = liveHighlights(book).filter((highlight) => !known.has(highlight.id))
  if (fresh.length === 0) {
    return null
  }
  return appendBlock(existing, fresh.map(renderHighlight).join('\n'))
}

function bookNote(book: ReadwiseBook): ConnectorNote | null {
  if (liveHighlights(book).length === 0) {
    return null
  }
  return {
    sourceId: String(book.user_book_id),
    fileStem: connectorFileStem(bookTitle(book), `Readwise ${book.user_book_id}`),
    source: renderReadwiseBook(book),
    merge: (existing) => mergeReadwiseBook(existing, book),
  }
}

async function verify(token: string, fetchFn: FetchFn): Promise<void> {
  const response = await fetchFn(`${API_BASE}/auth/`, { headers: authHeaders(token) })
  if (response.status === 401 || response.status === 403) {
    throw new ReflectError('auth', 'Readwise rejected the access token')
  }
  if (!response.ok) {
    throw new ReflectError('network', `Readwise: request failed (${response.status})`)
  }
}

async function* fetchNotes(input: ConnectorFetchInput): AsyncIterable<ConnectorNote> {
  let cursor: string | null = null
  do {
    const params = new URLSearchParams()
    if (input.since !== null) {
      params.set('updatedAfter', input.since.toISOString())
    }
    if (cursor !== null) {
      params.set('pageCursor', cursor)
    }
    const query = params.toString()
    const page = await getJson(
      input.fetchFn,
      `${API_BASE}/export/${query === '' ? '' : `?${query}`}`,
      authHeaders(input.token),
      exportPageSchema,
      'Readwise export',
    )
    for (const book of page.results) {
      const note = bookNote(book)
      if (note !== null) {
        yield note
      }
    }
    cursor = page.nextPageCursor == null ? null : String(page.nextPageCursor)
  } while (cursor !== null && !input.isStale())
}

/** The Readwise connector. */
export const readwiseConnector: Connector = {
  id: 'readwise',
  label: 'Readwise',
  description: 'Highlights from books, articles and podcasts, one note per source.',
  idKey: 'readwise_id',
  defaultFolder: 'Readwise',
  tokenUrl: 'https://readwise.io/access_token',
  tokenLabel: 'Access token',
  overlapMs: 10 * 60 * 1000,
  verify,
  fetchNotes,
}
