import { z } from 'zod'
import { tagPropertyTypeSchema, type TagProperty, type TagSymbolIconEntry } from '../../tags'
import type {
  CloudCollectionRow,
  CloudNoteListing,
  CloudSafe,
  CloudSearchHit,
  CloudTagListing,
} from '../checkers'

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
  'Not a type — leave it out to list all recent notes. Type names are single words like "book" or "project/atlas".'

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
  'Not a type — type names are single words like "book" or "project/atlas".'

/** Refusal for a real tag that has no type definition (no collection). */
export const UNTYPED_TAG_ERROR =
  'This type has no definition yet, so it has no collection. Use list_recent_notes with the type to list its notes instead.'

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

export interface ListTagsOutput {
  /** Every tag over non-private notes, gated like every other listing. */
  tags: CloudSafe<CloudTagListing>[]
}

export interface ListTagIconsOutput {
  /** Every symbol icon the app draws, by stored name, with a semantic hint. */
  icons: readonly TagSymbolIconEntry[]
}

/**
 * A proposed tag-icon change — the tag, its definition note, the icon to
 * store (`null` clears) and the one it replaces — or a refusal telling the
 * model what to fix. The user accepts or rejects it in chat; nothing is
 * written here.
 */
export type SetTagIconOutput =
  | { ok: true; tag: string; path: string; icon: string | null; previousIcon: string | null }
  | { ok: false; tag: string; error: string }

/** `set_tag_icon` refusals, read verbatim by both model and card. */
export const TAG_ICON_UNCHANGED_ERROR = 'The type already has this icon.'
export const TAG_DEFINITION_UNMARKED_ERROR =
  'A regular note lives at this type’s definition path (tags/<name>.md), so the type cannot be configured from chat — the user can convert it from the type’s page.'

export const setTagIconInput = z.object({
  tag: z.string().min(1).describe('The type to change (case-insensitive, without the #)'),
  icon: z
    .string()
    .nullable()
    .describe(
      'A symbol name from list_tag_icons (e.g. "buildings"), or one emoji. ' +
        'Pass null to remove the type’s icon.',
    ),
})

/** Cap on one proposed schema — a tag with more columns than this is not a chat edit. */
export const MAX_TAG_SCHEMA_PROPERTIES = 40

/**
 * A proposed tag-schema change: the definition note the accept writes, the
 * resulting property list beside the one it replaces (so the card renders a
 * real diff and the accept can detect drift), and the key renames whose
 * stored values the accept migrates. A refusal instead when the model must
 * fix something first. Nothing is written here.
 */
export type SetTagSchemaOutput =
  | {
      ok: true
      tag: string
      path: string
      properties: TagProperty[]
      previousProperties: TagProperty[]
      renames: { from: string; to: string }[]
    }
  | { ok: false; tag: string; error: string }

/** `set_tag_schema` refusals, read verbatim by both model and card. */
export const TAG_SCHEMA_UNCHANGED_ERROR = 'The type already has exactly this schema.'
export const TAG_SCHEMA_KEY_ERROR =
  'Every property needs a name and a frontmatter key made of letters, numbers, "-" or "_", and the key cannot be reserved app metadata (id, title, aliases, private, pinned, icon, properties…).'
export const TAG_SCHEMA_DUPLICATE_KEY_ERROR =
  'Two properties claim the same frontmatter key — each key appears once in a schema.'
export const TAG_SCHEMA_COMPUTED_ERROR =
  'Rollup, reverse and formula properties are computed from a configuration this tool cannot write — the user sets those up on the type’s page. Keep the ones the type already has (same key and property type) and leave them out of new properties.'
export const TAG_SCHEMA_RENAME_ERROR =
  'A "replaces" key must name a property the type’s schema has right now — list the type’s collection first to see its keys.'

const setTagSchemaProperty = z.object({
  name: z.string().min(1).describe('Display label for the column and the note field ("Read on")'),
  key: z
    .string()
    .nullish()
    .describe(
      'The frontmatter key the value lives under ("read-on"). Omit it to derive one ' +
        'from the name. Keep an existing property’s key exactly, or the values stored ' +
        'under it are orphaned.',
    ),
  type: tagPropertyTypeSchema.describe(
    'The property’s value kind. rollup, reverse and formula are computed and cannot ' +
      'be created here — carry an existing one over unchanged (same key and type) or ' +
      'leave it out.',
  ),
  options: z
    .array(z.string())
    .nullish()
    .describe('Choices for select, multiselect and status; ignored for other types.'),
  target: z
    .string()
    .nullish()
    .describe(
      'For relation, relations and person: the type whose notes the picker offers ' +
        '(no #). Omit for any note.',
    ),
  replaces: z
    .string()
    .nullish()
    .describe(
      'Set only when this property renames an existing one: the key it had before. ' +
        'Accepting then moves every note’s stored value to the new key.',
    ),
})

export const setTagSchemaInput = z.object({
  tag: z.string().min(1).describe('The type to configure (case-insensitive, without the #)'),
  properties: z
    .array(setTagSchemaProperty)
    .max(MAX_TAG_SCHEMA_PROPERTIES)
    .describe(
      'The type’s whole schema after the change, in column order — not just what you ' +
        'are adding. Read the current schema first (list_tags for the count, ' +
        'list_collection for the keys) and repeat every property you are keeping; ' +
        'anything you leave out is proposed for removal. An empty list clears the schema.',
    ),
})

/**
 * A proposed note-type change: the note, the tag whose membership the accept
 * writes, and whether it is being taken off instead of put on. A refusal
 * instead when the model must fix something first. Nothing is written here.
 */
export type SetNoteTypeOutput =
  | { ok: true; path: string; tag: string; remove: boolean }
  | { ok: false; path: string; tag: string; error: string }

/** `set_note_type` refusals, read verbatim by both model and card. */
export const NOTE_TYPE_UNCHANGED_ERROR = 'The note already has this type.'
export const NOTE_TYPE_ABSENT_ERROR =
  'The note does not have this type, so there is nothing to take off.'

export const setNoteTypeInput = z.object({
  path: z.string().min(1).describe('Graph-relative note path (from search or listing results)'),
  tag: z
    .string()
    .min(1)
    .describe('The type the note should have (case-insensitive, without the #)'),
  remove: z.boolean().optional().describe('Take the type off the note instead of putting it on'),
})

export const listTagsInput = z.object({})
export const listTagIconsInput = z.object({})

/** `edit_note` refusal for a path no note lives at. */
export const EDIT_NOTE_MISSING_ERROR = 'No note exists at this path.'

/** Cap on either side of one proposed edit — a whole-note rewrite is not a patch. */
export const MAX_EDIT_TEXT_CHARS = 20_000

/**
 * A proposed body edit (the hunk alone, so the model and the review card
 * share one compact record), or a refusal that tells the model what to fix.
 */
export type EditNoteOutput =
  | { ok: true; path: string; oldText: string; newText: string }
  | { ok: false; path: string; error: string }

export const editNoteInput = z.object({
  path: z.string().min(1).describe('Graph-relative note path (from search or listing results)'),
  oldText: z
    .string()
    .max(MAX_EDIT_TEXT_CHARS)
    .describe(
      'The exact current text to replace, copied verbatim from read_notes (whitespace ' +
        'included) and unique in the note. Pass an empty string to append newText at ' +
        'the end of the note instead.',
    ),
  newText: z
    .string()
    .max(MAX_EDIT_TEXT_CHARS)
    .describe('The replacement markdown (or, when oldText is empty, the text to append).'),
})

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
      'Only notes of this type (case-insensitive, without the #). ' +
        'Omit, or pass null, to list all recent notes.',
    ),
})

export const listCollectionInput = z.object({
  tag: z
    .string()
    .min(1)
    .describe('The type whose collection to list (case-insensitive, without the #)'),
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
