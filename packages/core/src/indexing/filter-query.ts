/**
 * The palette's filter grammar (Plan 08b): typed tokens parsed out of the
 * search query, leaving free text for FTS. Pure — the same parser serves the
 * palette now and the CLI's `search` later (Plan 14).
 *
 * Tokens (everything else is search text):
 * - `#tag`              — note carries the tag (repeatable, ANDed)
 * - `is:daily`          — daily notes only
 * - `is:pinned`         — pinned notes only
 * - `links:Target`      — notes that link **to** Target (quote multi-word:
 *                         `links:"Project X"`)
 * - `linked-from:Target`— notes Target links to
 * - `updated:>D`        — updated on or after `D` (`YYYY-MM-DD`, local)
 * - `updated:<D`        — updated before `D`
 * - `updated:D`         — updated during `D`
 * - `prop:key`          — note carries the frontmatter property (TDR 0005)
 * - `prop:key=value`    — property equals value, case-insensitive; matches a
 *                         multi-select entry and a relation's `[[value]]` too
 *                         (quote multi-word: `prop:status="in progress"`)
 *
 * Obsidian's search operators, so a vault's muscle memory carries over:
 * - `"exact phrase"`    — the words in order (a quoted single word matches
 *                         whole, not as a prefix)
 * - `-word`, `-"phrase"`— notes containing it are excluded
 * - `tag:#type` / `tag:type` — same as `#type`; every tag filter also matches
 *                         nested tags (`#type` finds `#type/person`)
 * - `-#tag`, `-tag:x`   — notes carrying the tag (or a nested one) excluded
 * - `path:CRM/`         — the note's vault path contains the text
 *                         (case-insensitive; quote spaces: `path:"Active Projects"`)
 * - `file:name`         — the note's file name contains the text
 * - `-path:x`, `-file:x`— the negations
 * - `[key]`, `[key:value]` — Obsidian's property syntax, same as `prop:`
 *                         (`[status:in progress]` may contain spaces)
 *
 * A malformed token (impossible date, empty value) stays search text — typing
 * never makes results vanish behind a filter the user didn't form yet.
 */
import { isCalendarDate } from '@reflect/utils'
import { foldTag } from '../markdown'
import { isTokenizable } from './search-query'

export interface SearchFilters {
  /** Folded tag keys ({@link foldTag} — tags match case-insensitively). */
  tags: string[]
  dailyOnly: boolean
  pinnedOnly: boolean
  /** Title/alias/date of the note results must link to. */
  linksTo: string | null
  /** Title/alias/date of the note results must be linked from. */
  linkedFrom: string | null
  /**
   * Exact path of the note results must link to. Never produced by the parser
   * (there is no token for it) — set by UI pickers that already hold the note,
   * so the filter targets that exact note even when titles are duplicated.
   * When set it takes precedence over {@link linksTo}.
   */
  linksToPath?: string | null
  /**
   * Exact path of the note results must be linked from — the picker-set
   * counterpart of {@link linkedFrom} (see {@link linksToPath}).
   */
  linkedFromPath?: string | null
  /** Inclusive lower bound on `mtime`, epoch ms (local day start). */
  updatedAfterMs: number | null
  /** Exclusive upper bound on `mtime`, epoch ms (local day start). */
  updatedBeforeMs: number | null
  /** Frontmatter property constraints (TDR 0005), ANDed. */
  properties: PropertyFilter[]
  /** Folded tag keys no result may carry (nested tags included). */
  excludedTags: string[]
  /** Text every result's vault path must contain (case-insensitive), ANDed. */
  paths: string[]
  /** Text no result's vault path may contain. */
  excludedPaths: string[]
  /** Text every result's file name must contain (case-insensitive), ANDed. */
  files: string[]
  /** Text no result's file name may contain. */
  excludedFiles: string[]
  /** Exact phrases every result's title or body must contain, ANDed. */
  phrases: string[]
  /** Words (matched as prefixes) no result's title or body may contain. */
  excludedTerms: string[]
  /** Exact phrases no result's title or body may contain. */
  excludedPhrases: string[]
}

/** One `prop:` token: the key must exist; with `value`, it must match. */
export interface PropertyFilter {
  /** Frontmatter key, verbatim (keys are case-sensitive like YAML). */
  key: string
  /** Case-insensitive value match, or null for bare existence. */
  value: string | null
}

export interface ParsedSearchQuery {
  /** The free text left for FTS once tokens are removed. */
  text: string
  filters: SearchFilters
  /** True when at least one filter token parsed. */
  filtered: boolean
}

const EMPTY_FILTERS: SearchFilters = {
  tags: [],
  dailyOnly: false,
  pinnedOnly: false,
  linksTo: null,
  linkedFrom: null,
  updatedAfterMs: null,
  updatedBeforeMs: null,
  properties: [],
  excludedTags: [],
  paths: [],
  excludedPaths: [],
  files: [],
  excludedFiles: [],
  phrases: [],
  excludedTerms: [],
  excludedPhrases: [],
}

/** Fresh filters with no constraint — arrays are never shared between calls. */
export function emptySearchFilters(): SearchFilters {
  return {
    ...EMPTY_FILTERS,
    tags: [],
    properties: [],
    excludedTags: [],
    paths: [],
    excludedPaths: [],
    files: [],
    excludedFiles: [],
    phrases: [],
    excludedTerms: [],
    excludedPhrases: [],
  }
}

/**
 * Wrap raw text as a parsed query with no filters — deliberately UNPARSED.
 * For callers whose input is literal text (AI retrieval, programmatic search)
 * where palette tokens like `is:daily` inside a sentence must stay search
 * terms, not become constraints.
 */
export function literalSearchQuery(text: string): ParsedSearchQuery {
  return { text, filters: emptySearchFilters(), filtered: false }
}

/**
 * Mirrors `isPropertyKey` in `tags/tag-type.ts` (a plain YAML-safe
 * identifier). A `prop:` token whose key could never be a property stays
 * search text, like every other malformed token.
 */
const PROPERTY_KEY_TOKEN_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Mirrors the indexed tag grammar (extract.ts TAG_RE: a leading letter, then
 * letter/number/slash/underscore/dash). A `#` token that couldn't have been
 * indexed (`#123`, `##work`) must stay search text — turning it into a filter
 * would guarantee zero rows for a tag that cannot exist.
 */
const TAG_TOKEN_RE = /^#\p{L}[\p{L}\p{N}/_-]*$/u

/** Epoch ms of the **local** start of `YYYY-MM-DD` (+`days`). */
function localDayStartMs(date: string, days = 0): number {
  // Callers gate on ISO_DATE_RE first, so the split always yields three parts.
  const parts = date.split('-').map(Number)
  const year = parts[0]!
  const month = parts[1]!
  const day = parts[2]!
  return new Date(year, month - 1, day + days).getTime()
}

/**
 * Split on whitespace, keeping `key:"quoted value"` (and bare quotes) whole,
 * and an Obsidian property token `[key:value with spaces]` whole. A `[[` is
 * a wiki link, not a property, so it splits like any other text.
 */
function tokenize(query: string): string[] {
  const tokens: string[] = []
  const chars = [...query]
  let current = ''
  let quoted = false
  let bracketed = false
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!
    if (current === '' && !quoted && char === '[' && chars[index + 1] !== '[') {
      bracketed = true
      current += char
    } else if (bracketed && char === ']') {
      bracketed = false
      current += char
    } else if (char === '"') {
      quoted = !quoted
      current += char
    } else if (!quoted && !bracketed && /\s/.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }
  if (current !== '') {
    tokens.push(current)
  }
  return tokens
}

function isQuoted(value: string): boolean {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
}

function unquote(value: string): string {
  return isQuoted(value) ? value.slice(1, -1) : value
}

/** The value of a `key:` token (quotes removed, trimmed), or null if empty. */
function operatorValue(token: string, prefix: string): string | null {
  const value = unquote(token.slice(prefix.length)).trim()
  return value === '' ? null : value
}

/** `#name`, `tag:#name` or `tag:name` as a folded tag key, else null. */
function tagKeyOf(token: string): string | null {
  const candidate = token.toLowerCase().startsWith('tag:')
    ? `#${token.slice('tag:'.length).replace(/^#/u, '')}`
    : token
  return TAG_TOKEN_RE.test(candidate) ? foldTag(candidate.slice(1)) : null
}

/** A quoted phrase FTS can see (at least one token character), else null. */
function phraseOf(token: string): string | null {
  if (!isQuoted(token)) {
    return null
  }
  const phrase = token.slice(1, -1).trim()
  return !phrase.includes('"') && isTokenizable(phrase) ? phrase : null
}

/**
 * Apply one `-`-prefixed token's body as an exclusion. Returns false when the
 * body forms no exclusion, so the whole token stays search text.
 */
function applyExclusion(body: string, filters: SearchFilters): boolean {
  const lower = body.toLowerCase()
  const tag = tagKeyOf(body)
  if (tag !== null) {
    filters.excludedTags.push(tag)
    return true
  }
  if (lower.startsWith('path:')) {
    const value = operatorValue(body, 'path:')
    if (value !== null) {
      filters.excludedPaths.push(value)
      return true
    }
    return false
  }
  if (lower.startsWith('file:')) {
    const value = operatorValue(body, 'file:')
    if (value !== null) {
      filters.excludedFiles.push(value)
      return true
    }
    return false
  }
  const phrase = phraseOf(body)
  if (phrase !== null) {
    filters.excludedPhrases.push(phrase)
    return true
  }
  if (!body.includes('"') && !body.startsWith('-') && isTokenizable(body)) {
    filters.excludedTerms.push(body)
    return true
  }
  return false
}

/** Obsidian's `[key]` / `[key:value]` property token, else null. */
function bracketPropertyOf(token: string): PropertyFilter | null {
  if (!token.startsWith('[') || token.startsWith('[[') || !token.endsWith(']')) {
    return null
  }
  const body = token.slice(1, -1)
  const colon = body.indexOf(':')
  const key = (colon === -1 ? body : body.slice(0, colon)).trim()
  const value = colon === -1 ? null : unquote(body.slice(colon + 1).trim()).trim()
  return PROPERTY_KEY_TOKEN_RE.test(key) && value !== '' ? { key, value } : null
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const filters = emptySearchFilters()
  const text: string[] = []
  let filtered = false

  for (const token of tokenize(query)) {
    const lower = token.toLowerCase()

    if (token.length > 1 && token.startsWith('-')) {
      if (applyExclusion(token.slice(1), filters)) {
        filtered = true
        continue
      }
      text.push(token)
      continue
    }
    const tag = tagKeyOf(token)
    if (tag !== null) {
      filters.tags.push(tag)
      filtered = true
      continue
    }
    const phrase = phraseOf(token)
    if (phrase !== null) {
      filters.phrases.push(phrase)
      filtered = true
      continue
    }
    const bracketProperty = bracketPropertyOf(token)
    if (bracketProperty !== null) {
      filters.properties.push(bracketProperty)
      filtered = true
      continue
    }
    if (lower.startsWith('path:')) {
      const value = operatorValue(token, 'path:')
      if (value !== null) {
        filters.paths.push(value)
        filtered = true
        continue
      }
    }
    if (lower.startsWith('file:')) {
      const value = operatorValue(token, 'file:')
      if (value !== null) {
        filters.files.push(value)
        filtered = true
        continue
      }
    }
    if (lower === 'is:daily') {
      filters.dailyOnly = true
      filtered = true
      continue
    }
    if (lower === 'is:pinned') {
      filters.pinnedOnly = true
      filtered = true
      continue
    }
    if (lower.startsWith('links:')) {
      const target = unquote(token.slice('links:'.length)).trim()
      if (target !== '') {
        filters.linksTo = target
        filtered = true
        continue
      }
    }
    if (lower.startsWith('linked-from:')) {
      const target = unquote(token.slice('linked-from:'.length)).trim()
      if (target !== '') {
        filters.linkedFrom = target
        filtered = true
        continue
      }
    }
    if (lower.startsWith('prop:')) {
      const body = token.slice('prop:'.length)
      const equals = body.indexOf('=')
      const key = equals === -1 ? body : body.slice(0, equals)
      const value = equals === -1 ? null : unquote(body.slice(equals + 1)).trim()
      if (PROPERTY_KEY_TOKEN_RE.test(key) && value !== '') {
        filters.properties.push({ key, value })
        filtered = true
        continue
      }
    }
    if (lower.startsWith('updated:')) {
      const value = token.slice('updated:'.length)
      const op = value.startsWith('>') || value.startsWith('<') ? value[0] : null
      const date = op === null ? value : value.slice(1)
      if (ISO_DATE_RE.test(date) && isCalendarDate(date)) {
        if (op === '>') {
          filters.updatedAfterMs = localDayStartMs(date)
        } else if (op === '<') {
          filters.updatedBeforeMs = localDayStartMs(date)
        } else {
          filters.updatedAfterMs = localDayStartMs(date)
          filters.updatedBeforeMs = localDayStartMs(date, 1)
        }
        filtered = true
        continue
      }
    }
    text.push(token)
  }

  return { text: text.join(' '), filters, filtered }
}

/** One active filter, as the palette shows it beside the query. */
export interface SearchFilterChip {
  /** Compact operator text, e.g. `#type/person`, `path: CRM/`, `"exact words"`. */
  readonly label: string
  /** True for exclusions (`-word`, `-#tag`, `-path:`…). */
  readonly negated: boolean
}

/** Local `YYYY-MM-DD` of an epoch-ms day start (the inverse of the parser). */
function localDate(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * The parsed filters as chips, in a stable order, so the palette can show
 * which tokens it understood (and which stayed plain search text).
 */
export function describeSearchFilters(filters: SearchFilters): SearchFilterChip[] {
  const include = (label: string): SearchFilterChip => ({ label, negated: false })
  const exclude = (label: string): SearchFilterChip => ({ label, negated: true })
  const chips: SearchFilterChip[] = [
    ...filters.phrases.map((phrase) => include(`"${phrase}"`)),
    ...filters.tags.map((tag) => include(`#${tag}`)),
    ...filters.paths.map((path) => include(`path: ${path}`)),
    ...filters.files.map((file) => include(`file: ${file}`)),
    ...filters.properties.map((property) =>
      include(
        property.value === null ? `[${property.key}]` : `[${property.key}: ${property.value}]`,
      ),
    ),
  ]
  if (filters.dailyOnly) {
    chips.push(include('is: daily'))
  }
  if (filters.pinnedOnly) {
    chips.push(include('is: pinned'))
  }
  if (filters.linksTo !== null) {
    chips.push(include(`links: ${filters.linksTo}`))
  }
  if (filters.linkedFrom !== null) {
    chips.push(include(`linked from: ${filters.linkedFrom}`))
  }
  if (filters.updatedAfterMs !== null) {
    chips.push(include(`updated ≥ ${localDate(filters.updatedAfterMs)}`))
  }
  if (filters.updatedBeforeMs !== null) {
    chips.push(include(`updated < ${localDate(filters.updatedBeforeMs)}`))
  }
  chips.push(
    ...filters.excludedTerms.map((term) => exclude(term)),
    ...filters.excludedPhrases.map((phrase) => exclude(`"${phrase}"`)),
    ...filters.excludedTags.map((tag) => exclude(`#${tag}`)),
    ...filters.excludedPaths.map((path) => exclude(`path: ${path}`)),
    ...filters.excludedFiles.map((file) => exclude(`file: ${file}`)),
  )
  return chips
}
