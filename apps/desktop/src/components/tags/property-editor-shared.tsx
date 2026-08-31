import type { ReactElement, ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  createNoteWithTitle,
  decodeStoredList,
  foldTag,
  getWikiAddressForPath,
  parseRating,
  suggestRelationTargets,
  suggestWikiLinkTargets,
  type CollectionValue,
  type TagProperty,
  type WikiLinkSuggestion,
} from '@reflect/core'
import { PopoverTrigger } from '@/components/ui/popover'
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
        : suggestRelationTargets(query, targetKey, 6),
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
export function creatableRowTitle(query: string): string | null {
  const title = query.replaceAll(WIKI_UNSAFE_RE, ' ').replaceAll(/\s+/g, ' ').trim()
  return title === '' ? null : title
}

/**
 * Create one row of a typed relation's target collection from its picker: a
 * note titled `title` carrying `#targetTag` in the body, born at a
 * collision-free slug path like every create-from-title. Returns the wiki
 * insert text for the new note — its verified address when the index has it
 * already (the local-write echo usually has), else the title itself, which
 * the new note claims as soon as the projection lands.
 */
export async function createRelationRow(
  targetTag: string,
  title: string,
  generation: number,
): Promise<string> {
  const path = await createNoteWithTitle(title, generation, `#${targetTag}`)
  try {
    const address = await getWikiAddressForPath(path)
    return address?.insertText ?? title
  } catch {
    return title
  }
}
