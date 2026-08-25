import type { ReactElement, ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  decodeStoredList,
  parseRating,
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
): readonly WikiLinkSuggestion[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'relation-targets', query],
    queryFn: () => suggestWikiLinkTargets(query, 6),
    enabled: open && bridgeReady && graph !== null,
    placeholderData: keepPreviousData,
  })
  return data?.suggestions ?? []
}
