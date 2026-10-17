import { sql, type RawBuilder } from 'kysely'
import { foldGraphPath } from '../graph/paths'
import type { SearchFilters } from './filter-query'
import { buildExcludedFtsMatch, buildPhraseFtsMatch } from './search-query'

/**
 * SQL for the palette's Obsidian search operators (filter-query), kept apart
 * from the ranked query in `filtered-search.ts` that composes them.
 */

/**
 * A tag key that is `tag` itself or nested beneath it (`type` also finds
 * `type/person`, as in Obsidian). The nested half is a range rather than a
 * LIKE so it stays on the `tag_key` index: every `type/…` key sorts between
 * `type/` and `type0` (`0` is the code point after `/`).
 */
export function tagMatchSql(column: RawBuilder<string>, tag: string): RawBuilder<boolean> {
  return sql<boolean>`(${column} = ${tag} or (${column} >= ${`${tag}/`} and ${column} < ${`${tag}0`}))`
}

/** `notes.path_key`'s last segment: the folded file name. */
const FILE_NAME_KEY = sql<string>`replace(notes.path_key, rtrim(notes.path_key, replace(notes.path_key, '/', '')), '')`

/** Join non-null FTS expressions, each parenthesized, or null when none. */
export function joinFts(
  parts: ReadonlyArray<string | null>,
  operator: 'AND' | 'OR',
): string | null {
  const present = parts.filter((part): part is string => part !== null)
  if (present.length <= 1) {
    return present[0] ?? null
  }
  return present.map((part) => `(${part})`).join(` ${operator} `)
}

function containsSql(
  haystack: RawBuilder<string>,
  needle: string,
  negated: boolean,
): RawBuilder<boolean> {
  return negated
    ? sql<boolean>`instr(${haystack}, ${foldGraphPath(needle)}) = 0`
    : sql<boolean>`instr(${haystack}, ${foldGraphPath(needle)}) > 0`
}

/**
 * The Obsidian operators as predicates on `notes`: excluded tags, path and
 * file-name containment, exact phrases, and excluded text. Path and file
 * names compare against `path_key` (NFC, ASCII-lowercased), so the needle is
 * folded the same way. Phrases and exclusions are FTS rowid sets —
 * `search_fts` rows carry their note's rowid — so each costs one MATCH
 * whatever the graph size, and title recall can never admit a row the phrase
 * or exclusion rules out.
 */
export function operatorPredicates(filters: SearchFilters): RawBuilder<boolean>[] {
  const pathKey = sql<string>`notes.path_key`
  const phrases = buildPhraseFtsMatch(filters.phrases)
  const excluded = buildExcludedFtsMatch(filters.excludedTerms, filters.excludedPhrases)
  return [
    ...filters.excludedTags.map(
      (tag) => sql<boolean>`not exists (
        select 1 from tags as excluded_tags
        where excluded_tags.note_path = notes.path
          and ${tagMatchSql(sql.ref('excluded_tags.tag_key'), tag)}
      )`,
    ),
    ...filters.paths.map((path) => containsSql(pathKey, path, false)),
    ...filters.excludedPaths.map((path) => containsSql(pathKey, path, true)),
    ...filters.files.map((file) => containsSql(FILE_NAME_KEY, file, false)),
    ...filters.excludedFiles.map((file) => containsSql(FILE_NAME_KEY, file, true)),
    ...(phrases === null
      ? []
      : [
          sql<boolean>`notes.rowid in (select rowid from search_fts where search_fts match ${phrases})`,
        ]),
    ...(excluded === null
      ? []
      : [
          sql<boolean>`notes.rowid not in (select rowid from search_fts where search_fts match ${excluded})`,
        ]),
  ]
}
