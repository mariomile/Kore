import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getNote,
  getNoteProperties,
  listNoteTagTypes,
  localCalendarDate,
  type CollectionValue,
  type TagProperty,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** A note's typed fields: the schema union and the stored values by key. */
export interface NoteTypedProperties {
  /** Empty while the note carries no typed tag (or nothing has loaded). */
  properties: TagProperty[]
  values: Record<string, CollectionValue> | undefined
}

/**
 * The typed properties a note carries (TDR 0005), shared by every surface
 * that renders a note as a row — the context rail's Properties section and
 * the properties header above the note body (Plan 29 N1).
 *
 * The union of the note's tag schemas comes back in tag-key order, then
 * property order; a key two tags declare renders once (the first declaration
 * wins), since the value under it is one frontmatter fact either way.
 */
export function useNoteTypedProperties(path: string): NoteTypedProperties {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && graph !== null

  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-tag-types', path],
    queryFn: () => listNoteTagTypes(path),
    enabled,
  })
  const { data: values } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-properties', path],
    queryFn: () => getNoteProperties(path),
    enabled,
  })

  const properties = useMemo(() => {
    const union: TagProperty[] = []
    const claimed = new Set<string>()
    for (const entry of tagTypes ?? []) {
      for (const property of entry.type.properties) {
        if (!claimed.has(property.key)) {
          claimed.add(property.key)
          union.push(property)
        }
      }
    }
    return union
  }, [tagTypes])

  // The `updated` fields are a view over the index's mtime, exactly like the
  // collection rows' cells (attachTimestampColumns) — never a stored value.
  // Fetched only when the schema union actually declares one (same query key
  // as `useNoteRowState`, so a mounted row consumer shares the cache).
  const wantsMtime = properties.some((property) => property.type === 'updated')
  const { data: row } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note', path],
    queryFn: async () => (await getNote(path)) ?? null,
    enabled: enabled && wantsMtime,
  })
  const mtime = row?.mtime ?? 0

  const overlaid = useMemo(() => {
    if (values === undefined || !properties.some((property) => property.type === 'updated')) {
      return values
    }
    const next = { ...values }
    for (const property of properties) {
      if (property.type !== 'updated') {
        continue
      }
      if (mtime > 0) {
        next[property.key] = {
          value: localCalendarDate(new Date(mtime)),
          valueType: 'string',
          valueNumber: null,
        }
      } else {
        delete next[property.key]
      }
    }
    return next
  }, [values, properties, mtime])

  return { properties, values: overlaid }
}
