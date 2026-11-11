import { z } from 'zod'
import { KoreError } from '../errors'
import type { FetchFn } from '../sync/github-api'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { getJson } from './http'
import { appendBlock, headingText, indentContinuation, noteWithFrontmatter } from './markdown'
import type { Connector, ConnectorFetchInput, ConnectorNote } from './types'

/**
 * Readwise (books, articles, tweets, podcasts — everything synced to
 * Readwise) through its export API, one note per source document. A
 * highlight's identity is its `readwise.io/open/<id>` link, so a later run
 * appends only highlights the note does not already carry: edits, reordering
 * and deletions the user made stay untouched.
 *
 * Where notes land is the user's path pattern (`{title}` by default, with
 * `{category}` and `{author}` available). A file another Readwise sync wrote
 * at that path (the official Obsidian plugin, say) is adopted rather than
 * duplicated: its highlights are recognized by their Reader link or by their
 * text, and new ones are appended under a dated heading.
 *
 * API reference: https://readwise.io/api_deets
 */

const API_BASE = 'https://readwise.io/api/v2'

const tagSchema = z.object({ name: z.string() })

const highlightSchema = z.object({
  id: z.number(),
  /** Reader's id for the highlight; the plugin links it as `read.readwise.io/read/<id>`. */
  external_id: z.string().nullish(),
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
const READER_LINK_RE = /read\.readwise\.io\/read\/([0-9a-z]+)/gi

/** The highlight ids a note already carries. */
export function readwiseHighlightIds(source: string): Set<number> {
  return new Set(Array.from(source.matchAll(HIGHLIGHT_LINK_RE), (match) => Number(match[1])))
}

function comparableText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Whether `source` already holds `highlight`: by its Readwise link (Kore's
 * notes), its Reader link (the Obsidian plugin's), or its text (the plugin's
 * Kindle and podcast highlights, which link a location instead).
 */
function carries(
  source: { ids: Set<number>; readerIds: Set<string>; text: string },
  highlight: ReadwiseHighlight,
): boolean {
  if (source.ids.has(highlight.id)) {
    return true
  }
  const readerId = highlight.external_id?.toLowerCase()
  if (readerId && source.readerIds.has(readerId)) {
    return true
  }
  const text = comparableText(highlight.text)
  return text !== '' && source.text.includes(text)
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

/** A category as a `{category}` value (`articles` → `Articles`). */
export function readwiseCategoryName(category: string | null | undefined): string {
  const name = (category ?? '').trim()
  return name === '' ? '' : name.charAt(0).toUpperCase() + name.slice(1)
}

function bookUrl(book: ReadwiseBook): string | undefined {
  return book.source_url ?? book.unique_url ?? undefined
}

function bookTitle(book: ReadwiseBook): string {
  return headingText(book.readable_title ?? book.title ?? '') || `Readwise ${book.user_book_id}`
}

/** The full markdown for a book's first sync; `tags` lead its tag list. */
export function renderReadwiseBook(book: ReadwiseBook, tags: readonly string[]): string {
  const title = bookTitle(book)
  const url = bookUrl(book)
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
      url,
      tags: Array.from(
        new Set([...tags, ...(book.book_tags ?? []).map((tag) => tagSlug(tag.name))]),
      ),
    },
    `${sections.join('\n\n')}\n`,
  )
}

function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Append the highlights `existing` does not carry yet, under a dated
 * `### New highlights added` heading; `null` when none are new.
 */
export function mergeReadwiseBook(
  existing: string,
  book: ReadwiseBook,
  now: Date = new Date(),
): string | null {
  const known = {
    ids: readwiseHighlightIds(existing),
    readerIds: new Set(
      Array.from(existing.matchAll(READER_LINK_RE), (match) => (match[1] ?? '').toLowerCase()),
    ),
    text: comparableText(existing),
  }
  const fresh = liveHighlights(book).filter((highlight) => !carries(known, highlight))
  if (fresh.length === 0) {
    return null
  }
  return appendBlock(
    existing,
    `### New highlights added ${localDay(now)}\n\n${fresh.map(renderHighlight).join('\n')}`,
  )
}

/**
 * Whether `existing`, a file without a `readwise_id` at this book's path, is
 * the Obsidian plugin's note for it: same source URL, or the plugin's marks
 * (its cover image or a Readwise link).
 */
export function adoptsReadwiseFile(existing: string, book: ReadwiseBook): boolean {
  const url: unknown = parseFrontmatter(splitFrontmatter(existing).raw).data['url']
  if (typeof url === 'string' && url !== '' && url === bookUrl(book)) {
    return true
  }
  return existing.includes('![rw-book-cover]') || /readwise\.io\//.test(existing)
}

function bookNote(book: ReadwiseBook, tags: readonly string[]): ConnectorNote | null {
  if (liveHighlights(book).length === 0) {
    return null
  }
  return {
    sourceId: String(book.user_book_id),
    fields: {
      title: bookTitle(book),
      category: readwiseCategoryName(book.category),
      author: headingText(book.author ?? ''),
    },
    source: renderReadwiseBook(book, tags),
    merge: (existing) => mergeReadwiseBook(existing, book),
    adopts: (existing) => adoptsReadwiseFile(existing, book),
  }
}

async function verify(token: string, fetchFn: FetchFn): Promise<void> {
  const response = await fetchFn(`${API_BASE}/auth/`, { headers: authHeaders(token) })
  if (response.status === 401 || response.status === 403) {
    throw new KoreError('auth', 'Readwise rejected the access token')
  }
  if (!response.ok) {
    throw new KoreError('network', `Readwise: request failed (${response.status})`)
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
      const note = bookNote(book, input.tags)
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
  defaultPattern: '{title}',
  patternFields: ['title', 'category', 'author'],
  defaultTags: ['readwise'],
  tokenUrl: 'https://readwise.io/access_token',
  tokenLabel: 'Access token',
  tokenNoun: 'access token',
  overlapMs: 10 * 60 * 1000,
  verify,
  fetchNotes,
}
