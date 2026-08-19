import { sql } from 'kysely'
import { db } from './db'

/**
 * Unlinked mentions (Obsidian's "unlinked references"): other notes whose
 * prose contains this note's title without linking to it. The recall is one
 * FTS phrase query over the indexed body text; the exact occurrence — with
 * word boundaries, outside existing wiki links — is then confirmed in JS
 * against the indexed `noteText`, which also computes the offset the
 * one-click link conversion needs. Private notes never appear as sources:
 * their text is in the index, but surfacing it in another note's panel would
 * leak content the privacy block promises to keep out of sight.
 */

export interface UnlinkedMention {
  sourcePath: string
  sourceTitle: string
  /** The mentioned note's title — the spelling the link conversion targets. */
  targetTitle: string
  /** One trimmed line of context around the first unlinked occurrence. */
  snippet: string
  /** The matched text's range inside {@link snippet}. */
  matchStart: number
  matchEnd: number
  /** Offset of the occurrence in the source note's indexed text. */
  posFrom: number
}

/**
 * Titles shorter than this never produce mentions: one- and two-character
 * titles ("a", "AI") match half the graph and read as noise, not recall.
 */
export const MIN_MENTION_TITLE_LENGTH = 3

/** A character that continues a word — a match must not touch one on either side. */
const WORD_CHAR_RE = /[\p{L}\p{N}]/u

/** `[[target]]` / `[[target|alias]]` spans, where a title occurrence is already a link. */
const WIKI_LINK_RE = /\[\[[^\n\]]*\]\]/g

/** Ranges of `text` already inside wiki links, in document order. */
function wikiLinkRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = Array.from(
    text.matchAll(WIKI_LINK_RE),
    (match) => ({ from: match.index, to: match.index + match[0].length }),
  )
  return ranges
}

/**
 * The first case-insensitive, word-bounded occurrence of `title` in `text`
 * that is not already inside a wiki link, or `null`. Shared by the panel
 * query (to build snippets) and the link conversion (to edit the same
 * occurrence it showed).
 */
export function findUnlinkedOccurrence(
  text: string,
  title: string,
): { from: number; to: number } | null {
  const needle = title.toLowerCase()
  if (needle.length === 0) {
    return null
  }
  const haystack = text.toLowerCase()
  const linkRanges = wikiLinkRanges(text)
  let cursor = 0
  while (cursor <= haystack.length - needle.length) {
    const from = haystack.indexOf(needle, cursor)
    if (from === -1) {
      return null
    }
    const to = from + needle.length
    cursor = from + 1
    const before = text[from - 1]
    const after = text[to]
    if (before !== undefined && WORD_CHAR_RE.test(before)) {
      continue
    }
    if (after !== undefined && WORD_CHAR_RE.test(after)) {
      continue
    }
    if (linkRanges.some((range) => from < range.to && to > range.from)) {
      continue
    }
    return { from, to }
  }
  return null
}

/** How much context to keep on each side of the match when a line runs long. */
const SNIPPET_CONTEXT = 100

/** The match's line, ellipsis-trimmed around the occurrence when it runs long. */
function snippetAround(
  text: string,
  occurrence: { from: number; to: number },
): { snippet: string; matchStart: number; matchEnd: number } {
  const lineStart = text.lastIndexOf('\n', occurrence.from - 1) + 1
  const lineEndIndex = text.indexOf('\n', occurrence.to)
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex
  let from = lineStart
  let to = lineEnd
  let prefix = ''
  let suffix = ''
  if (occurrence.from - from > SNIPPET_CONTEXT) {
    from = occurrence.from - SNIPPET_CONTEXT
    prefix = '…'
  }
  if (to - occurrence.to > SNIPPET_CONTEXT) {
    to = occurrence.to + SNIPPET_CONTEXT
    suffix = '…'
  }
  const body = text.slice(from, to)
  const leadingTrim = body.length - body.trimStart().length
  const snippet = prefix + body.trim() + suffix
  const matchStart = prefix.length + (occurrence.from - from) - leadingTrim
  return { snippet, matchStart, matchEnd: matchStart + (occurrence.to - occurrence.from) }
}

/** Wrap a phrase as an FTS5 string literal, doubling quotes (FTS5's own escape). */
function quoteFtsPhrase(phrase: string): string {
  return `"${phrase.replaceAll('"', '""')}"`
}

/** Result cap — the panel is a nudge, not a report. */
const DEFAULT_MENTION_LIMIT = 20

/**
 * Notes that mention `path`'s title without linking to it, most recent
 * first. Sources that already link to the note, the note itself, and private
 * notes are excluded up front; the FTS recall is then confirmed against the
 * indexed text so tokenizer near-misses (hyphenation, partial words) never
 * surface. Notes with short titles return no mentions at all
 * ({@link MIN_MENTION_TITLE_LENGTH}).
 */
export async function getUnlinkedMentions(
  path: string,
  options: { limit?: number } = {},
): Promise<UnlinkedMention[]> {
  const limit = options.limit ?? DEFAULT_MENTION_LIMIT
  const note = await db
    .selectFrom('notes')
    .where('path', '=', path)
    .select(['title', 'dailyDate'])
    .executeTakeFirst()
  const title = note?.title.trim() ?? ''
  // Daily notes are date-titled: a prose occurrence of the date string is a
  // date, not a mention of the note. Skip them entirely.
  if (note?.dailyDate != null || title.length < MIN_MENTION_TITLE_LENGTH) {
    return []
  }

  const recency = sql<number>`coalesce(
    strftime('%s', "notes"."daily_date") * 1000,
    "notes"."updated_at"
  )`
  const candidates = await db
    .selectFrom('searchFts')
    .innerJoin('notes', 'notes.path', 'searchFts.path')
    .innerJoin('noteText', 'noteText.notePath', 'notes.path')
    .where(sql<boolean>`search_fts MATCH ${`body : ${quoteFtsPhrase(title)}`}`)
    .where('notes.path', '!=', path)
    .where('notes.isPrivate', '=', 0)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('backlinks')
            .where('backlinks.targetPath', '=', path)
            .whereRef('backlinks.sourcePath', '=', 'notes.path')
            .select('backlinks.sourcePath'),
        ),
      ),
    )
    .select(['notes.path as sourcePath', 'notes.title as sourceTitle', 'noteText.text as text'])
    .$narrowType<{ sourcePath: string; sourceTitle: string; text: string }>()
    .orderBy(recency, 'desc')
    .orderBy('notes.path')
    .limit(limit * 2)
    .execute()

  const mentions: UnlinkedMention[] = []
  for (const candidate of candidates) {
    const occurrence = findUnlinkedOccurrence(candidate.text, title)
    if (occurrence === null) {
      continue
    }
    mentions.push({
      sourcePath: candidate.sourcePath,
      sourceTitle: candidate.sourceTitle,
      targetTitle: title,
      posFrom: occurrence.from,
      ...snippetAround(candidate.text, occurrence),
    })
    if (mentions.length >= limit) {
      break
    }
  }
  return mentions
}
