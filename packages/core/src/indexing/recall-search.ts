import { sql } from 'kysely'
import { db } from './db'
import { buildRecallFtsMatch } from './search-query'

/**
 * Vault recall for chat (roadmap Now item 3a): the ranked passages a chat
 * turn surfaces *without being asked*. Where the search palette ANDs its
 * terms (every term must hold), recall ORs them and lets bm25 grade the
 * hits — a message rarely repeats a note verbatim, but the note matching
 * most of its words is the one worth resurfacing.
 *
 * Chat rides into cloud prompts, so unlike the palette — a local-only
 * surface that deliberately searches everything — this query excludes
 * private notes at the SQL level. Templates are scaffolding, not facts,
 * and are excluded too. Deterministic on purpose: one FTS query, no model
 * call, same index → same hits, so scenarios are testable.
 */

export interface RecallHit {
  path: string
  title: string
  /** ISO date for daily notes; null for regular notes. */
  dailyDate: string | null
  /**
   * The FTS snippet around the best match, plain text (no highlight
   * markers — it rides into a prompt, not a UI), or null when FTS produced
   * none; callers fall back to `preview`.
   */
  snippet: string | null
  /** The note's stored preview line. */
  preview: string
}

/**
 * The ranked recall hits for a set of message terms, best first. `limit`
 * bounds the SQL; the chat layer applies its own tighter prompt budget on
 * top. Returns `[]` when no term is tokenizable.
 */
export async function recallSearchHits(terms: string[], limit = 8): Promise<RecallHit[]> {
  const match = buildRecallFtsMatch(terms)
  if (match === null) {
    return []
  }
  const rows = await db
    .selectFrom('searchFts')
    .innerJoin('notes', 'notes.path', 'searchFts.path')
    .where('notes.isPrivate', '=', 0)
    .where('notes.kind', '!=', 'template')
    .where(sql<boolean>`search_fts MATCH ${match}`)
    .select([
      'notes.path',
      'notes.title',
      'notes.dailyDate',
      'notes.preview',
      sql<string>`snippet(search_fts, 2, '', '', '…', 12)`.as('snippet'),
      sql<number>`bm25(search_fts, 0, 10.0, 1.0)`.as('rank'),
    ])
    .orderBy(sql`bm25(search_fts, 0, 10.0, 1.0)`)
    .orderBy('notes.mtime', 'desc')
    .orderBy('notes.path', 'asc')
    .limit(limit)
    .execute()
  return rows.map(({ rank: _rank, snippet, ...row }) => ({
    ...row,
    snippet: snippet.trim() === '' ? null : snippet,
  }))
}
