import { collisionStem, noteFileStemForTitle, notePath } from '@reflect/core/graph/paths'
import { isTagName, newNoteSource, patchProperties, replacePassage, appendBlock } from './edits'
import { MAX_SOURCE_BYTES, byteLength, isNotePath, isPrivateSource } from './note'
import type { NoteStore, StoredNote } from './store'

/** A tool's answer: text for the agent, flagged when it is a refusal. */
export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: true
}

/** Raised for anything the agent should read as a refusal, not a crash. */
export class ToolError extends Error {}

type Args = Record<string, unknown>

interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint: false; idempotentHint: boolean }
  run: (store: NoteStore, args: Args) => Promise<unknown>
}

/** Vault-root files that hold the user's rules for agents, in priority order. */
export const CONTRACT_PATHS = ['AGENTS.md', 'CLAUDE.md'] as const

/** Contract text inlined into `instructions` beyond this is left to `vault_guide`. */
export const INSTRUCTIONS_CONTRACT_MAX_CHARS = 12_000

/** How many times a structural write rereads and reapplies after losing a race. */
const WRITE_ATTEMPTS = 3

/** Collision-suffix attempts before `create_note` gives up on a title. */
const CREATE_ATTEMPTS = 20

export const INSTRUCTIONS = `Tools over the user's Kore notes, kept always on in their own Kore Cloud: \
Markdown files with [[wiki links]], #tags, frontmatter properties, tasks, and one daily note \
per day. A <note> argument accepts a YYYY-MM-DD date, a vault-relative path, or a title. \
Search first, then read_note what you need. Notes the user marked private never reach Kore \
Cloud. Writes are structural: they append, create, set properties, or replace one passage \
whose exact current text you pass (edit_note), so nothing overwrites a change you have not \
read; the user's Kore app picks every write up on its next sync. Call vault_guide first: it \
returns the vault's own agent contract (its rules, including where memory and new notes go) \
and a map of its folders.`

const noteSchema = {
  type: 'string',
  description: 'A YYYY-MM-DD date, vault-relative path, or note title',
}
function limitSchema(fallback: number) {
  return {
    type: 'integer',
    minimum: 1,
    description: `Maximum results (default ${fallback})`,
  }
}

function string(args: Args, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new ToolError(`\`${key}\` must be a string`)
  }
  return value
}

function required(args: Args, key: string): string {
  const value = string(args, key)
  if (value === undefined || value.trim() === '') {
    throw new ToolError(`\`${key}\` is required`)
  }
  return value
}

function limit(args: Args, fallback: number, max: number): number {
  const value = args.limit
  if (value === undefined || value === null) {
    return fallback
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ToolError('`limit` must be a positive integer')
  }
  return Math.min(value, max)
}

function record(args: Args, key: string): Record<string, unknown> {
  const value = args[key]
  if (value === undefined || value === null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError(`\`${key}\` must be an object`)
  }
  return value as Record<string, unknown>
}

function strings(args: Args, key: string): string[] {
  const value = args[key]
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ToolError(`\`${key}\` must be a list of strings`)
  }
  return value as string[]
}

/** A date, a path (with or without `.md`), or a title → the live note. */
export async function resolveNote(store: NoteStore, reference: string): Promise<StoredNote> {
  const ref = reference.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    const daily = await store.byDaily(ref)
    if (daily !== null) {
      return daily
    }
  }
  for (const path of ref.endsWith('.md') ? [ref] : [`${ref}.md`]) {
    if (isNotePath(path)) {
      const note = await store.get(path)
      if (note !== null) {
        return note
      }
    }
  }
  const titled = await store.byTitle(ref)
  if (titled !== null) {
    return titled
  }
  throw new ToolError(`No note matches "${ref}". Search for it first.`)
}

function guardSource(source: string): void {
  if (isPrivateSource(source)) {
    throw new ToolError(
      'Kore Cloud never holds private notes. Mark a note private in the Kore app instead.',
    )
  }
  if (byteLength(source) > MAX_SOURCE_BYTES) {
    throw new ToolError('The note would be larger than Kore Cloud stores (1 MB).')
  }
}

/**
 * Read the note, apply `edit`, and write it back guarded by the version that
 * was read. When another writer got there first, reread and reapply, so the
 * edit always lands on the current text and never replaces someone else's.
 */
async function rewrite(
  store: NoteStore,
  reference: string,
  edit: (source: string) => string,
): Promise<StoredNote & { written: number }> {
  let note = await resolveNote(store, reference)
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const next = edit(note.source)
    guardSource(next)
    const outcome = await store.write({ path: note.path, source: next, baseVersion: note.version })
    if (outcome.status === 'ok') {
      return { ...note, source: next, version: outcome.version, written: outcome.version }
    }
    const current = await store.get(note.path)
    if (current === null) {
      throw new ToolError(`${note.path} was deleted while you were writing to it.`)
    }
    note = current
  }
  throw new ToolError(`${note.path} kept changing while you wrote to it. Read it and try again.`)
}

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const
const add = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const

export const TOOLS: readonly Tool[] = [
  {
    name: 'vault_guide',
    description:
      "Start here, once per session, before reading or writing. Returns the vault's agent contract (the user's rules for every agent: where memory, decisions and new notes go, what not to touch; null when the vault has none) and a map of its folders with note counts. Follow the contract over your own defaults.",
    inputSchema: { type: 'object', properties: {} },
    annotations: read,
    run: async (store) => {
      const contract = await vaultContract(store)
      return {
        contract: contract === null ? null : { path: contract.path, text: contract.source },
        folders: await store.folders(),
      }
    },
  },
  {
    name: 'search',
    description:
      'Full-text search over every note: titles weigh most, then tags, then body text. Words match regardless of accents and the last word matches as a prefix. Returns paths, titles and the matching passage.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: limitSchema(20) },
      required: ['query'],
    },
    annotations: read,
    run: async (store, args) => {
      const results = await store.search(required(args, 'query'), limit(args, 20, 50))
      return { results }
    },
  },
  {
    name: 'read_note',
    description: "Read one note's full Markdown content, with its path, title and daily date.",
    inputSchema: { type: 'object', properties: { note: noteSchema }, required: ['note'] },
    annotations: read,
    run: async (store, args) => {
      const note = await resolveNote(store, required(args, 'note'))
      return {
        path: note.path,
        title: note.title,
        daily: note.daily,
        updatedAt: note.updatedAt,
        content: note.source,
      }
    },
  },
  {
    name: 'recent_notes',
    description: 'The most recently updated notes, newest first.',
    inputSchema: { type: 'object', properties: { limit: limitSchema(20) } },
    annotations: read,
    run: async (store, args) => {
      const notes = await store.recent(limit(args, 20, 100))
      return {
        notes: notes.map(({ path, title, daily, updatedAt }) => ({
          path,
          title,
          daily,
          updatedAt,
        })),
      }
    },
  },
  {
    name: 'append_to_note',
    description: 'Append a Markdown block to the end of an existing note, after one blank line.',
    inputSchema: {
      type: 'object',
      properties: { note: noteSchema, markdown: { type: 'string' } },
      required: ['note', 'markdown'],
    },
    annotations: add,
    run: async (store, args) => {
      const markdown = required(args, 'markdown')
      const note = await rewrite(store, required(args, 'note'), (source) =>
        appendBlock(source, markdown),
      )
      return { path: note.path, appended: true }
    },
  },
  {
    name: 'edit_note',
    description:
      "Replace one exact passage of a note's body with new text (or append, when oldText is empty). read_note first and copy oldText verbatim, whitespace included, with enough surrounding words to occur exactly once. Nothing is written when oldText is missing or repeated, so an edit never overwrites a change made since you read the note: re-read and retry. Frontmatter is out of reach (use set_properties).",
    inputSchema: {
      type: 'object',
      properties: {
        note: noteSchema,
        oldText: {
          type: 'string',
          description:
            "The exact current text to replace, unique in the note's body. Empty string: append newText at the end.",
        },
        newText: {
          type: 'string',
          description: 'The replacement Markdown (or the text to append).',
        },
      },
      required: ['note', 'oldText', 'newText'],
    },
    annotations: add,
    run: async (store, args) => {
      const oldText = string(args, 'oldText') ?? ''
      const newText = string(args, 'newText')
      if (newText === undefined) {
        throw new ToolError('`newText` is required')
      }
      const note = await rewrite(store, required(args, 'note'), (source) => {
        const edited = replacePassage(source, oldText, newText)
        if ('refused' in edited) {
          throw new ToolError(
            edited.refused === 'missing'
              ? 'oldText does not occur in the note. Read it again and copy the passage exactly.'
              : 'oldText occurs more than once. Include more surrounding words so it is unique.',
          )
        }
        return edited.source
      })
      return { path: note.path, edited: true }
    },
  },
  {
    name: 'create_note',
    description:
      'Create a new note with a title, optional Markdown body, tags and properties, in the folder the vault creates notes in. Fails if a note with that title already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown placed under the title' },
        tags: { type: 'array', items: { type: 'string' } },
        properties: { type: 'object', description: 'Frontmatter values by key; lists as arrays' },
      },
      required: ['title'],
    },
    annotations: add,
    run: async (store, args) => {
      const title = required(args, 'title').trim()
      const tags = strings(args, 'tags').map((tag) => tag.trim().replace(/^#/, ''))
      const bad = tags.find((tag) => !isTagName(tag))
      if (bad !== undefined) {
        throw new ToolError(
          `"${bad}" is not a tag name (a letter, then letters, digits, /, _ or -)`,
        )
      }
      if ((await store.byTitle(title)) !== null) {
        throw new ToolError(
          `A note titled "${title}" already exists. Use append_to_note or edit_note.`,
        )
      }
      const source = newNoteSource(
        title,
        string(args, 'body') ?? '',
        tags,
        record(args, 'properties'),
      )
      guardSource(source)
      const stem = noteFileStemForTitle(title)
      for (let ordinal = 1; ordinal <= CREATE_ATTEMPTS; ordinal += 1) {
        const path = notePath(collisionStem(stem, ordinal))
        const outcome = await store.write({ path, source, baseVersion: 0 })
        if (outcome.status === 'ok') {
          return { path, title }
        }
      }
      throw new ToolError(`No free file name for "${title}".`)
    },
  },
  {
    name: 'set_properties',
    description:
      'Set or remove frontmatter properties on a note. Values are written as given (lists as arrays); the rest of the note is kept byte for byte.',
    inputSchema: {
      type: 'object',
      properties: {
        note: noteSchema,
        set: { type: 'object', description: 'Values by key; lists as arrays' },
        unset: { type: 'array', items: { type: 'string' }, description: 'Keys to remove' },
      },
      required: ['note'],
    },
    annotations: add,
    run: async (store, args) => {
      const set = record(args, 'set')
      const unset = strings(args, 'unset')
      if (Object.keys(set).length === 0 && unset.length === 0) {
        throw new ToolError('Pass `set`, `unset`, or both.')
      }
      const note = await rewrite(store, required(args, 'note'), (source) =>
        patchProperties(source, set, unset),
      )
      return { path: note.path, updated: true }
    },
  },
]

/** The vault's agent contract note, if it has one. */
export async function vaultContract(store: NoteStore): Promise<StoredNote | null> {
  for (const path of CONTRACT_PATHS) {
    const note = await store.get(path)
    if (note !== null && note.source.trim() !== '') {
      return note
    }
  }
  return null
}

/** Run one tool; refusals come back as error results, not exceptions. */
export async function callTool(store: NoteStore, name: string, args: Args): Promise<ToolResult> {
  const tool = TOOLS.find((candidate) => candidate.name === name)
  if (tool === undefined) {
    return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true }
  }
  try {
    const value = await tool.run(store, args)
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
  } catch (error) {
    if (error instanceof ToolError) {
      return { content: [{ type: 'text', text: error.message }], isError: true }
    }
    throw error
  }
}
