import type { ReactElement, ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  createNoteWithTitle,
  startingValuesFor,
  decodeStoredList,
  foldTag,
  getTagType,
  getWikiAddressForPath,
  listNoteTags,
  listTagTypes,
  parseRating,
  relationCreateTarget,
  suggestRelationTargets,
  suggestWikiLinkTargets,
  type CollectionValue,
  type TagProperty,
  type WikiLinkSuggestion,
} from '@kore/core'
import { PopoverTrigger } from '@/components/ui/popover'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { allNotesTagsQueryKey } from '@/lib/notes/all-notes-query'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * The shared per-type property editors (TDR 0005), used by Collection cells
 * and the note's properties panel. Every editor commits through one channel:
 * `onCommit(value)` with the typed YAML value, or `undefined` to delete the
 * key — the caller routes it into the frontmatter patch.
 */

export interface PropertyEditorProps {
  property: TagProperty
  /** The stored value (from `note_properties`), or undefined when unset. */
  value: CollectionValue | undefined
  /** Persist a new value (`undefined` deletes the key). */
  onCommit: (value: unknown) => void
  /** Follow a relation's target note (offered as the picker's first item). */
  onOpenRelation?: (target: string) => void
  /** The read-only display the editor opens from. */
  children: ReactNode
  align?: 'start' | 'end'
}

/** The stored value's text form for an input seed ('' when unset). */
export function editorSeedText(value: CollectionValue | undefined): string {
  return value === undefined || value.valueType === 'list' ? '' : value.value
}

/** The stored value as a list (for multi-select editing). */
export function editorSeedList(value: CollectionValue | undefined): string[] {
  if (value === undefined) {
    return []
  }
  if (value.valueType === 'list') {
    return decodeStoredList(value.value) ?? []
  }
  return value.value === '' ? [] : [value.value]
}

/** Convert an input's committed text into the typed YAML value. */
export function typedValueForText(property: TagProperty, text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') {
    return undefined
  }
  if (property.type === 'number') {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (property.type === 'rating') {
    const parsed = Number(trimmed)
    return parseRating(parsed) ?? undefined
  }
  if (property.type === 'files') {
    const entries = trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    return entries.length === 0 ? undefined : entries
  }
  return trimmed
}

export interface EditorTriggerProps {
  name: string
  children: ReactNode
}

/** The one read-only trigger every popover editor opens from: cell-sized
 * even when empty, and click-transparent to the row's select/open gestures. */
export function EditorTrigger({ name, children }: EditorTriggerProps): ReactElement {
  return (
    <PopoverTrigger
      aria-label={`Edit ${name}`}
      className="flex min-h-5 w-full min-w-0 items-center self-stretch text-left focus-visible:outline-none"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </PopoverTrigger>
  )
}

/**
 * How many rows a typed relation's picker lists. A collection is a short,
 * known set (areas, people, projects): cut it at the editor's six and the
 * seventh row is unreachable without typing, which reads as "wrong notes".
 * Matches the candidate query's own cap; the list scrolls.
 */
const RELATION_ROWS_LIMIT = 50

/** The relation pickers' shared note suggestions: the same verified `[[`
 * autocomplete the editor uses, fetched only while the popover is open. */
export function useRelationSuggestions(
  open: boolean,
  query: string,
  /** A typed relation's target tag: only that collection's rows are offered. */
  targetTag?: string,
): readonly WikiLinkSuggestion[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const targetKey = targetTag === undefined ? null : foldTag(targetTag)
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'relation-targets', targetKey, query],
    queryFn: () =>
      targetKey === null
        ? suggestWikiLinkTargets(query, 6)
        : suggestRelationTargets(query, targetKey, RELATION_ROWS_LIMIT),
    enabled: open && bridgeReady && graph !== null,
    placeholderData: keepPreviousData,
  })
  return data?.suggestions ?? []
}

/** Characters markdown cannot carry inside `[[…]]` — dropped from a created row's title. */
const WIKI_UNSAFE_RE = /[[\]|\\\r\n]+/g

/**
 * The title a picker's "Create" entry would give a new row, or `null` when
 * the query holds nothing a wiki link could name.
 */
function creatableRowTitle(query: string): string | null {
  const title = query.replaceAll(WIKI_UNSAFE_RE, ' ').replaceAll(/\s+/g, ' ').trim()
  return title === '' ? null : title
}

/** A relation picker's "Create" entry: what it says, and the note it makes. */
export interface RelationCreateEntry {
  label: string
  /** Create the note and resolve to its wiki insert text. */
  create: () => Promise<string>
}

/**
 * The "Create" entry both relation pickers offer, or `null` when the query
 * names nothing new (empty, or an exact title already suggested). The note
 * files into `relationCreateTarget`: the declared target, else the vault's
 * collection named like the field, else none (a plain note). The vault's tag
 * lists load only while the picker is open, on the same cache keys the schema
 * dialog's target picker reads.
 */
export function useRelationCreateEntry(
  property: TagProperty,
  open: boolean,
  query: string,
  suggestions: readonly WikiLinkSuggestion[],
): RelationCreateEntry | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const enabled = open && bridgeReady && graph !== null
  const { data: noteTags } = useQuery({
    queryKey: allNotesTagsQueryKey(graph?.root),
    queryFn: () => listNoteTags(),
    enabled,
  })
  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-types'],
    queryFn: () => listTagTypes(),
    enabled,
  })
  const title = creatableRowTitle(query)
  if (
    title === null ||
    graph === null ||
    suggestions.some((suggestion) => suggestion.title.toLowerCase() === title.toLowerCase())
  ) {
    return null
  }
  const target = relationCreateTarget(property, [
    ...(noteTags ?? []).map((facet) => facet.tag),
    ...(tagTypes ?? []).map((entry) => entry.tagKey),
  ])
  return {
    label: target === undefined ? `Create note “${title}”` : `Create “${title}” in #${target}`,
    create: () => createRelationRow(target, title, graph.generation),
  }
}

/**
 * Create the note a relation picker's "Create" entry names: a note titled
 * `title`, carrying `#targetTag` in the body when the field files into a
 * collection (else a plain note), born at a collision-free slug path like
 * every create-from-title. Returns the wiki
 * insert text for the new note — its verified address when the index has it
 * already (the local-write echo usually has), else the title itself, which
 * the new note claims as soon as the projection lands.
 */
async function createRelationRow(
  targetTag: string | undefined,
  title: string,
  generation: number,
): Promise<string> {
  if (targetTag === undefined) {
    return await insertTextFor(await createNoteWithTitle(title, generation), title)
  }
  const path = await createNoteWithTitle(title, generation, `#${targetTag}`)
  // A row born from the picker carries its `created` stamps (Plan 29 T1)
  // and starting values (Plan 33 B4) too — best-effort: a failed stamp
  // never loses the created note.
  try {
    const stamps = await startingValuesFor(targetTag, await getTagType(targetTag))
    if (Object.keys(stamps).length > 0) {
      await commitNoteFrontmatter(path, { properties: stamps }, generation)
    }
  } catch {
    // The note exists; the stamp can be filled by hand.
  }
  return await insertTextFor(path, title)
}

/** A created note's wiki insert text: its verified address, else its title. */
async function insertTextFor(path: string, title: string): Promise<string> {
  try {
    const address = await getWikiAddressForPath(path)
    return address?.insertText ?? title
  } catch {
    return title
  }
}
