import { z } from 'zod'
import type { TagProperty } from '../../tags'
import type { CloudCollectionRow, CloudNoteListing, CloudSafe, CloudSearchHit } from '../checkers'

/**
 * The note tools' wire contract: input schemas, output shapes, and the
 * verbatim refusal strings — everything `./tools` registers with the model
 * and the chip renders, minus the executors themselves.
 */

/** Default and ceiling for search hits per call (token budget, not recall). */
export const DEFAULT_SEARCH_LIMIT = 8
const MAX_SEARCH_LIMIT = 20

/** Default and ceiling for recent-note listings per call. */
export const DEFAULT_RECENT_LIMIT = 10
const MAX_RECENT_LIMIT = 20

/** Most days one daily-range call returns; past it the model narrows the range. */
export const MAX_DAILY_NOTE_DAYS = 31

/** Default and ceiling for collection rows per call. */
export const DEFAULT_COLLECTION_LIMIT = 30
const MAX_COLLECTION_LIMIT = 100

export interface SearchNotesOutput {
  hits: CloudSafe<CloudSearchHit>[]
}

/**
 * A listing, or a corrective refusal for a `tag` the tag grammar can never
 * produce. Without the refusal a junk filter (`*`, `all`, whitespace…) reads
 * as a clean "0 notes" — indistinguishable from a real tag nothing carries —
 * and a model hunting for an "all notes" sentinel just keeps guessing.
 */
export type ListRecentNotesOutput =
  | { ok: true; notes: CloudSafe<CloudNoteListing>[] }
  | { ok: false; tag: string; error: string }

/** The refusal text — one string, read verbatim by both model and chip. */
export const INVALID_TAG_ERROR =
  'Not a tag — omit the tag to list all recent notes. Tags are single words like "book" or "project/atlas".'

export interface ListDailyNotesOutput {
  days: CloudSafe<CloudNoteListing>[]
  /** The range held more days than one call returns — narrow it to see the rest. */
  truncated: boolean
}

/**
 * A collection listing, or a corrective refusal — same policy as
 * {@link ListRecentNotesOutput}: junk tags and untyped tags each get a
 * refusal that tells the model what to do instead of a misleading "0 rows".
 */
export type ListCollectionOutput =
  | {
      ok: true
      tag: string
      /** The tag's schema — one entry per property column. */
      schema: TagProperty[]
      rows: CloudSafe<CloudCollectionRow>[]
      /** More public rows exist than the limit returned. */
      truncated: boolean
    }
  | { ok: false; tag: string; error: string }

/** Refusal for a `tag` input the tag grammar can never produce. */
export const INVALID_COLLECTION_TAG_ERROR =
  'Not a tag — tags are single words like "book" or "project/atlas".'

/** Refusal for a real tag that has no type definition (no collection). */
export const UNTYPED_TAG_ERROR =
  'This tag has no type, so it has no collection. Use list_recent_notes with the tag to list its notes instead.'

/** `set_note_property` refusals, read verbatim by both model and chip. */
export const EDITS_DISABLED_ERROR =
  'Editing is disabled — the user can turn on "Allow edits" in the chat settings.'
export const RESERVED_PROPERTY_ERROR =
  'That key is reserved app metadata (or not a valid property key) and cannot be set.'
export const PRIVATE_NOTE_EDIT_ERROR =
  'This note is marked private — the assistant cannot read or change it.'
export const MISSING_VALUE_ERROR = 'Provide a value, or pass clear=true to remove the property.'

export type SetNotePropertyValue = string | number | boolean | string[] | null

export type SetNotePropertyOutput =
  | { ok: true; path: string; key: string; value: SetNotePropertyValue }
  | { ok: false; path: string; error: string }

/** Compact preview of a proposed property value (null means clear). */
export function formatPropertyPreview(value: SetNotePropertyValue): string {
  if (value === null) {
    return 'cleared'
  }
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  return String(value)
}

export const setNotePropertyInput = z.object({
  path: z.string().min(1).describe('Graph-relative note path (from search or listing results)'),
  key: z.string().min(1).describe('The frontmatter property key to write (e.g. "status")'),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .nullish()
    .describe('The new value. Omit it and pass clear=true to remove the property instead.'),
  clear: z.boolean().optional().describe('Remove the property instead of setting a value'),
})

export const searchNotesInput = z.object({
  query: z.string().min(1).describe('Full-text search query over the note graph'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe(`How many notes to return (default ${DEFAULT_SEARCH_LIMIT})`),
})

export const listRecentNotesInput = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_RECENT_LIMIT)
    .optional()
    .describe(`How many notes to return (default ${DEFAULT_RECENT_LIMIT})`),
  tag: z
    .string()
    .nullish()
    .describe(
      'Only notes carrying this tag (case-insensitive, without the #). ' +
        'Omit, or pass null, to list all recent notes.',
    ),
})

export const listCollectionInput = z.object({
  tag: z
    .string()
    .min(1)
    .describe('The typed tag whose collection to list (case-insensitive, without the #)'),
  sortBy: z
    .string()
    .nullish()
    .describe(
      'Property key to sort the rows by (a `key` from the collection schema). ' +
        'Omit, or pass null, for the default order (pinned first, then newest).',
    ),
  direction: z.enum(['asc', 'desc']).nullish().describe('Sort direction (default asc)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_COLLECTION_LIMIT)
    .optional()
    .describe(`How many rows to return (default ${DEFAULT_COLLECTION_LIMIT})`),
})

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'an ISO date, YYYY-MM-DD')

export const listDailyNotesInput = z.object({
  start: isoDate.describe('First day of the range, inclusive (YYYY-MM-DD)'),
  end: isoDate.describe('Last day of the range, inclusive (YYYY-MM-DD)'),
})
