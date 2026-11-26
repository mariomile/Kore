import { inferFieldFromValues, type StoredFieldValue } from '../bases/convert-fields'
import { DESCRIPTION_SUFFIX, TAGS_DIR } from '../graph/paths'
import { foldTag, isTagName } from '../markdown'
import { isPropertyKey, type TagProperty } from '../tags/tag-type'
import { typeHomeFolder } from '../tags/type-folder'
import { db } from './db'
import type { NoteListEntry } from './note-list'

/**
 * The first look at a vault Kore has never opened (the "alive in 10
 * seconds" first launch): live counts while the first index runs, what the
 * folder and tag structure already says about the notes (types to offer,
 * one tap each), and three checks that need no AI: notes nothing links,
 * links to notes that don't exist, and titles used more than once. Every
 * figure is a read-only projection over the index; nothing here writes.
 * Like Insights, everything that names a note reads `is_private = 0` rows
 * only.
 */

/** Live counts for the first index, cheap enough to re-read every tick. */
export interface VaultTally {
  /** Regular notes (not dailies, not templates). */
  notes: number
  dailyNotes: number
  /** Wiki links between notes, resolved or not. */
  links: number
  tasks: number
}

/** Where a type suggestion comes from, and so what applying it writes. */
export type TypeSuggestionSource =
  /** A tag many notes already carry: applying writes one definition note. */
  | 'tag'
  /** A folder of notes sharing no tag: applying also tags each note. */
  | 'folder'

/** One "these notes are a kind of thing" Kore read from the vault. */
export interface TypeSuggestion {
  readonly source: TypeSuggestionSource
  /** The tag the type is (an existing tag, or the folder's name folded). */
  readonly tag: string
  /** A human label: the tag's last segment, or the folder's name for a folder. */
  readonly label: string
  /** How many notes become the type's members. */
  readonly count: number
  /** The folder the notes live in (most of them, for a tag), or null. */
  readonly folder: string | null
}

/** A note named by a check. */
export interface FirstLookNote {
  readonly path: string
  readonly title: string
}

/** A link target no note answers to, with who links it. */
export interface BrokenLinkTarget {
  /** The target as first written (`[[Target]]` without brackets). */
  readonly target: string
  /** How many links point at it. */
  readonly links: number
  /** The notes those links sit in (up to {@link CHECK_SAMPLE}). */
  readonly sources: readonly FirstLookNote[]
}

/** Notes sharing one title, which makes a `[[Title]]` link ambiguous. */
export interface DuplicateTitle {
  readonly title: string
  readonly notes: readonly FirstLookNote[]
}

/** What the first look shows once the first index has finished. */
export interface VaultFirstLook {
  readonly suggestions: readonly TypeSuggestion[]
  /** Notes with no link in or out (dailies excluded: a day stands alone). */
  readonly orphans: { readonly count: number; readonly sample: readonly FirstLookNote[] }
  /** Wiki links whose target matches no note. */
  readonly brokenLinks: {
    readonly links: number
    readonly targets: number
    readonly sample: readonly BrokenLinkTarget[]
  }
  /** Titles carried by more than one note. */
  readonly duplicates: { readonly count: number; readonly sample: readonly DuplicateTitle[] }
}

/** A tag or folder needs this many notes before it reads as a type. */
export const MIN_TYPE_NOTES = 10
/** At most this many type suggestions, biggest first. */
const MAX_SUGGESTIONS = 6
/** A folder holding this share of a tag's notes is the tag's home. */
const DOMINANT_FOLDER_SHARE = 0.8
/** A folder suggests a type only when this share of its notes has no tag. */
const FOLDER_UNTAGGED_SHARE = 0.6
/** How many items each check lists. */
export const CHECK_SAMPLE = 50
/** A field joins a suggested type when this share of its notes has it. */
const COMMON_FIELD_SHARE = 0.4
/** At most this many fields on a suggested type. */
const MAX_FIELDS = 6
/**
 * Keys that are bookkeeping, not a field anyone would want as a column:
 * Obsidian's hierarchy and styling keys, and the tags themselves.
 */
const NON_FIELD_KEYS: ReadonlySet<string> = new Set([
  'tags',
  'tag',
  'up',
  'cssclass',
  'cssclasses',
  'publish',
  'kore',
])
/** A link target naming a file other than a note (`photo.png`, `deck.pdf`). */
const NON_NOTE_TARGET = /\.(?!md$)[a-z0-9]{2,5}$/i

/** Load the live counts for the first index. */
export async function loadVaultTally(): Promise<VaultTally> {
  const [noteRows, linkRow, taskRow] = await Promise.all([
    db
      .selectFrom('notes')
      .where('kind', '!=', 'template')
      .groupBy('kind')
      .select((eb) => ['kind', eb.fn.countAll<number>().as('count')])
      .execute(),
    db
      .selectFrom('links')
      .where('kind', '=', 'wiki')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst(),
    db
      .selectFrom('tasks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst(),
  ])
  const byKind = new Map(noteRows.map((row) => [row.kind, Number(row.count)]))
  return {
    notes: byKind.get('note') ?? 0,
    dailyNotes: byKind.get('daily') ?? 0,
    links: Number(linkRow?.count ?? 0),
    tasks: Number(taskRow?.count ?? 0),
  }
}

/**
 * The most recently edited notes, newest first, as All Notes rows: the cards
 * that fill in while the first index runs.
 */
export async function loadFirstLookRecentNotes(limit: number): Promise<NoteListEntry[]> {
  const rows = await db
    .selectFrom('notes')
    .where('kind', '=', 'note')
    .where('isPrivate', '=', 0)
    .where('path', 'not like', `${TAGS_DIR}/%`)
    .orderBy('mtime', 'desc')
    .orderBy('path')
    .limit(limit)
    .select(['path', 'title', 'preview', 'mtime', 'isPinned'])
    .execute()
  if (rows.length === 0) {
    return []
  }
  const tagRows = await db
    .selectFrom('tags')
    .where(
      'notePath',
      'in',
      rows.map((row) => row.path),
    )
    .where('member', '=', 1)
    .orderBy('tag')
    .select(['notePath', 'tag'])
    .execute()
  const tagsByPath = new Map<string, string[]>()
  for (const row of tagRows) {
    const list = tagsByPath.get(row.notePath) ?? []
    list.push(row.tag)
    tagsByPath.set(row.notePath, list)
  }
  return rows.map((row) => ({
    path: row.path,
    title: row.title,
    snippet: row.preview,
    tags: tagsByPath.get(row.path) ?? [],
    mtime: row.mtime,
    isPinned: row.isPinned === 1,
  }))
}

/** The note's folder, `''` at the vault root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function lastSegment(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1)
}

function humanLabel(value: string): string {
  const words = lastSegment(value).replaceAll(/[-_]+/g, ' ').trim()
  return words === '' ? value : words.charAt(0).toUpperCase() + words.slice(1)
}

/** True for notes the checks and suggestions read: regular, not Kore's own bookkeeping. */
function isPlainNote(path: string): boolean {
  return !path.startsWith(`${TAGS_DIR}/`) && !path.endsWith(DESCRIPTION_SUFFIX)
}

interface PlainNote {
  readonly path: string
  readonly title: string
  readonly titleKey: string
}

/** Load the type suggestions and the three checks. */
export async function loadVaultFirstLook(): Promise<VaultFirstLook> {
  const [noteRows, tagRows, typeRows, linkRows, resolvedRows, propertyRows] = await Promise.all([
    db
      .selectFrom('notes')
      .where('kind', '=', 'note')
      .where('isPrivate', '=', 0)
      .select(['path', 'title', 'titleKey'])
      .execute(),
    db
      .selectFrom('tags')
      .innerJoin('notes', 'notes.path', 'tags.notePath')
      .where('notes.kind', '=', 'note')
      .where('notes.isPrivate', '=', 0)
      .where('tags.member', '=', 1)
      .select(['tags.notePath', 'tags.tag', 'tags.tagKey'])
      .execute(),
    db.selectFrom('tagTypes').select(['tagKey', 'schemaJson']).execute(),
    db
      .selectFrom('links')
      .innerJoin('notes', 'notes.path', 'links.sourcePath')
      .where('notes.kind', '!=', 'template')
      .where('notes.isPrivate', '=', 0)
      .where('links.kind', '=', 'wiki')
      .select(['links.sourcePath', 'links.targetRaw', 'links.targetKey', 'links.posFrom'])
      .execute(),
    db.selectFrom('backlinks').select(['sourcePath', 'targetPath', 'posFrom']).execute(),
    db.selectFrom('noteProperties').select(['notePath', 'key']).execute(),
  ])
  const notes: PlainNote[] = noteRows.filter((row) => isPlainNote(row.path))
  const titleByPath = new Map(notes.map((note) => [note.path, note.title]))
  const named = (path: string): FirstLookNote => ({ path, title: titleByPath.get(path) ?? path })

  return {
    suggestions: typeSuggestions(notes, tagRows, typeRows, propertyRows),
    orphans: orphanNotes(notes, linkRows, resolvedRows, named),
    brokenLinks: brokenLinks(linkRows, resolvedRows, named),
    duplicates: duplicateTitles(notes, named),
  }
}

interface TagRow {
  readonly notePath: string
  readonly tag: string
  readonly tagKey: string
}

/**
 * Whether a tag names a kind of thing rather than a topic, and how surely:
 * one point each for its notes living in one folder, sharing a field (every
 * person has an email, every meeting attendees; a topic's notes share
 * nothing), and a name that says so (`type/person`). Zero means a topic.
 */
function kindScore(tag: string, folder: string | null, sharesField: boolean): number {
  const declared = foldTag(tag).startsWith('type/')
  return (folder === null ? 0 : 1) + (sharesField ? 1 : 0) + (declared ? 1 : 0)
}

/** True when some field is carried by {@link COMMON_FIELD_SHARE} of these notes. */
function sharesAField(
  paths: readonly string[],
  fieldsOfPath: ReadonlyMap<string, readonly string[]>,
): boolean {
  const counts = new Map<string, number>()
  for (const path of paths) {
    for (const key of fieldsOfPath.get(path) ?? []) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const needed = paths.length * COMMON_FIELD_SHARE
  return [...counts.values()].some((count) => count >= needed)
}

function typeSuggestions(
  notes: readonly PlainNote[],
  tagRows: readonly TagRow[],
  typeRows: readonly { readonly tagKey: string; readonly schemaJson: string }[],
  propertyRows: readonly { readonly notePath: string; readonly key: string }[],
): TypeSuggestion[] {
  const plain = new Set(notes.map((note) => note.path))
  const typed = new Set(typeRows.map((row) => row.tagKey))
  const typeFolders = new Set(
    typeRows.flatMap((row) => {
      const folder = typeFolderOf(row.schemaJson)
      return folder === null ? [] : [folder]
    }),
  )
  const fieldsOfPath = new Map<string, string[]>()
  for (const row of propertyRows) {
    if (isPropertyKey(row.key) && !NON_FIELD_KEYS.has(row.key)) {
      const keys = fieldsOfPath.get(row.notePath) ?? []
      keys.push(row.key)
      fieldsOfPath.set(row.notePath, keys)
    }
  }

  // tag key → its first-seen casing and member paths; the notes with any tag.
  const tags = new Map<string, { tag: string; paths: string[] }>()
  const tagged = new Set<string>()
  for (const row of tagRows) {
    if (!plain.has(row.notePath)) {
      continue
    }
    const entry = tags.get(row.tagKey) ?? { tag: row.tag, paths: [] }
    entry.paths.push(row.notePath)
    tags.set(row.tagKey, entry)
    tagged.add(row.notePath)
  }

  const ranked: { suggestion: TypeSuggestion; score: number }[] = []
  for (const [key, { tag, paths }] of tags) {
    if (typed.has(key) || paths.length < MIN_TYPE_NOTES) {
      continue
    }
    const folder = dominantFolder(paths)
    const score = kindScore(tag, folder, sharesAField(paths, fieldsOfPath))
    if (score === 0) {
      continue
    }
    ranked.push({
      score,
      suggestion: { source: 'tag', tag, label: humanLabel(tag), count: paths.length, folder },
    })
  }

  const byFolder = new Map<string, string[]>()
  for (const note of notes) {
    const folder = folderOf(note.path)
    if (folder === '') {
      continue
    }
    const list = byFolder.get(folder) ?? []
    list.push(note.path)
    byFolder.set(folder, list)
  }
  for (const [folder, paths] of byFolder) {
    if (paths.length < MIN_TYPE_NOTES || typeFolders.has(folder)) {
      continue
    }
    const tag = foldTag(lastSegment(folder).replaceAll(/\s+/g, '-'))
    if (!isTagName(tag) || typed.has(tag) || tags.has(tag)) {
      continue
    }
    // Only a folder of untagged notes: where the notes carry tags, those
    // tags are the suggestion (or a topic), not the folder.
    const untagged = paths.filter((path) => !tagged.has(path)).length
    if (untagged / paths.length < FOLDER_UNTAGGED_SHARE) {
      continue
    }
    ranked.push({
      // A folder is one signal; sharing a field makes it a second.
      score: 1 + (sharesAField(paths, fieldsOfPath) ? 1 : 0),
      suggestion: { source: 'folder', tag, label: humanLabel(folder), count: paths.length, folder },
    })
  }

  return ranked
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.suggestion.count - left.suggestion.count ||
        left.suggestion.tag.localeCompare(right.suggestion.tag),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.suggestion)
}

function typeFolderOf(schemaJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(schemaJson)
    if (typeof parsed === 'object' && parsed !== null && 'folder' in parsed) {
      const folder = parsed.folder
      return typeof folder === 'string' ? typeHomeFolder(folder) : null
    }
  } catch {
    // An unreadable schema simply claims no folder.
  }
  return null
}

/** The folder holding most of these notes, or null when they are spread out. */
function dominantFolder(paths: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const folder = folderOf(path)
    counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  let best: [string, number] | null = null
  for (const entry of counts) {
    if (best === null || entry[1] > best[1]) {
      best = entry
    }
  }
  return best !== null && best[0] !== '' && best[1] / paths.length >= DOMINANT_FOLDER_SHARE
    ? best[0]
    : null
}

interface LinkRow {
  readonly sourcePath: string
  readonly targetRaw: string
  readonly targetKey: string
  readonly posFrom: number
}

interface ResolvedRow {
  readonly sourcePath: string | null
  readonly targetPath: string | null
  readonly posFrom: number | null
}

function linkId(sourcePath: string | null, posFrom: number | null): string {
  return `${sourcePath ?? ''}\u{0}${posFrom ?? -1}`
}

function orphanNotes(
  notes: readonly PlainNote[],
  linkRows: readonly LinkRow[],
  resolvedRows: readonly ResolvedRow[],
  named: (path: string) => FirstLookNote,
): VaultFirstLook['orphans'] {
  const linked = new Set<string>()
  for (const row of linkRows) {
    linked.add(row.sourcePath)
  }
  for (const row of resolvedRows) {
    if (row.targetPath !== null && row.targetPath !== row.sourcePath) {
      linked.add(row.targetPath)
    }
  }
  const orphans = notes.filter((note) => !linked.has(note.path))
  return {
    count: orphans.length,
    sample: orphans
      .slice()
      .sort((left, right) => left.title.localeCompare(right.title))
      .slice(0, CHECK_SAMPLE)
      .map((note) => named(note.path)),
  }
}

function brokenLinks(
  linkRows: readonly LinkRow[],
  resolvedRows: readonly ResolvedRow[],
  named: (path: string) => FirstLookNote,
): VaultFirstLook['brokenLinks'] {
  const resolved = new Set(resolvedRows.map((row) => linkId(row.sourcePath, row.posFrom)))
  const byTarget = new Map<string, { target: string; links: number; sources: Set<string> }>()
  let links = 0
  for (const row of linkRows) {
    // No name reading (`[[#Heading]]`, a rooted path) or a file that isn't a
    // note (`![[photo.png]]`): neither is a missing note.
    if (row.targetKey === '' || NON_NOTE_TARGET.test(row.targetRaw.trim())) {
      continue
    }
    if (resolved.has(linkId(row.sourcePath, row.posFrom))) {
      continue
    }
    links += 1
    const entry = byTarget.get(row.targetKey) ?? {
      target: row.targetRaw.trim(),
      links: 0,
      sources: new Set<string>(),
    }
    entry.links += 1
    entry.sources.add(row.sourcePath)
    byTarget.set(row.targetKey, entry)
  }
  const ranked = [...byTarget.values()].sort(
    (left, right) => right.links - left.links || left.target.localeCompare(right.target),
  )
  return {
    links,
    targets: ranked.length,
    sample: ranked.slice(0, CHECK_SAMPLE).map((entry) => ({
      target: entry.target,
      links: entry.links,
      sources: [...entry.sources].slice(0, CHECK_SAMPLE).map(named),
    })),
  }
}

function duplicateTitles(
  notes: readonly PlainNote[],
  named: (path: string) => FirstLookNote,
): VaultFirstLook['duplicates'] {
  const byTitle = new Map<string, string[]>()
  for (const note of notes) {
    if (note.titleKey === '') {
      continue
    }
    const list = byTitle.get(note.titleKey) ?? []
    list.push(note.path)
    byTitle.set(note.titleKey, list)
  }
  const groups = [...byTitle.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => paths.sort().map(named))
    .sort(
      (left, right) =>
        right.length - left.length || (left[0]?.title ?? '').localeCompare(right[0]?.title ?? ''),
    )
  return {
    count: groups.length,
    sample: groups.slice(0, CHECK_SAMPLE).map((group) => ({
      title: group[0]?.title ?? '',
      notes: group,
    })),
  }
}

/**
 * The fields a suggested type starts with: each frontmatter key at least
 * {@link COMMON_FIELD_SHARE} of its notes carry, typed from the values they
 * hold (the same conservative guess as a converted base), most common first.
 */
export async function inferSuggestionFields(suggestion: TypeSuggestion): Promise<TagProperty[]> {
  const members = new Set(await suggestionMemberPaths(suggestion))
  if (members.size === 0) {
    return []
  }
  const rows =
    suggestion.source === 'tag'
      ? await db
          .selectFrom('noteProperties')
          .innerJoin('tags', 'tags.notePath', 'noteProperties.notePath')
          .where('tags.tagKey', '=', foldTag(suggestion.tag))
          .where('tags.member', '=', 1)
          .select([
            'noteProperties.notePath',
            'noteProperties.key',
            'noteProperties.value',
            'noteProperties.valueType',
          ])
          .execute()
      : await db
          .selectFrom('noteProperties')
          .where('notePath', 'like', `${suggestion.folder ?? ''}/%`)
          .select(['notePath', 'key', 'value', 'valueType'])
          .execute()
  const byKey = new Map<string, { notes: Set<string>; values: StoredFieldValue[] }>()
  for (const row of rows) {
    if (!members.has(row.notePath) || !isPropertyKey(row.key) || NON_FIELD_KEYS.has(row.key)) {
      continue
    }
    const entry = byKey.get(row.key) ?? { notes: new Set<string>(), values: [] }
    entry.notes.add(row.notePath)
    entry.values.push({ value: row.value, valueType: row.valueType })
    byKey.set(row.key, entry)
  }
  return [...byKey]
    .filter(([, entry]) => entry.notes.size / members.size >= COMMON_FIELD_SHARE)
    .sort(
      (left, right) => right[1].notes.size - left[1].notes.size || left[0].localeCompare(right[0]),
    )
    .slice(0, MAX_FIELDS)
    .map(([key, entry]) => inferFieldFromValues(key, humanLabel(key), entry.values))
}

/**
 * The notes a suggestion is about: the tag's member notes, or the notes
 * filed directly in the folder (subfolders are their own suggestion).
 */
export async function suggestionMemberPaths(suggestion: TypeSuggestion): Promise<string[]> {
  if (suggestion.source === 'tag') {
    const rows = await db
      .selectFrom('tags')
      .innerJoin('notes', 'notes.path', 'tags.notePath')
      .where('tags.tagKey', '=', foldTag(suggestion.tag))
      .where('tags.member', '=', 1)
      .where('notes.kind', '=', 'note')
      .select('tags.notePath')
      .execute()
    return rows.map((row) => row.notePath).filter(isPlainNote)
  }
  const folder = suggestion.folder ?? ''
  // LIKE narrows; the exact folder test below discards a `%`/`_` in the name
  // matching more than itself, and the notes of subfolders.
  const rows = await db
    .selectFrom('notes')
    .where('kind', '=', 'note')
    .where('path', 'like', `${folder}/%`)
    .select('path')
    .execute()
  return rows
    .map((row) => row.path)
    .filter((path) => folderOf(path) === folder && isPlainNote(path))
}
