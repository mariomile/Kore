import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  EMPTY_TAG_TYPE,
  foldTag,
  type CollectionEmbed,
  type CollectionEmbedView,
  type CollectionEntry,
  type NoteListEntry,
  type TagType,
} from '@reflect/core'
import { isModEvent } from '@meowdown/core'
import { ExternalLink, Settings, Sliders } from '@/components/icons'
import { AllNotesGrid } from '@/components/all-notes/all-notes-grid'
import {
  CollectionBoard,
  groupableProperties,
  tableGroupRows,
} from '@/components/all-notes/collection-board'
import { calendarProperty, CollectionCalendar } from '@/components/all-notes/collection-calendar'
import { CollectionTable } from '@/components/all-notes/collection-table'
import {
  applyCollectionFilters,
  CollectionFilterMenu,
} from '@/components/all-notes/collection-filter-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { groupablePropertiesOf } from '@/lib/tags/schema-views'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { CollectionDefinitionDialog } from '@/components/notes/collection-definition-dialog'
import { ReusableCollectionActions } from '@/components/notes/reusable-collection-actions'
import { useCollection } from '@/hooks/use-collection'
import { useReusableCollection } from '@/hooks/use-reusable-collection'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { tagTypeQueryKey, useTagType } from '@/hooks/use-tag-type'
import { useTemplateValues } from '@/hooks/use-template-values'
import { createTitledCollectionNote } from '@/lib/tags/create-collection-note'
import { addTagProperty, removeTagProperty } from '@/lib/tags/schema-edits'
import {
  addReusableCollectionMember,
  createReusableCollectionRow,
  removeReusableCollectionMember,
} from '@/lib/tags/reusable-collection-write'
import { useListSelection } from '@/lib/selection/use-list-selection'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { routeForPath } from '@/routing/route'

export interface EmbeddedCollectionProps {
  embed: CollectionEmbed
  /** Persist arrangement changes back into this fence's source. */
  onChange?: ((embed: CollectionEmbed) => void) | undefined
}

const VIEW_LABEL: Record<CollectionEmbedView, string> = {
  table: 'Table',
  grid: 'Grid',
  board: 'Board',
  calendar: 'Calendar',
}

const VIEW_OPTIONS: readonly CollectionEmbedView[] = ['table', 'grid', 'board', 'calendar']

function gridNotes(entries: readonly CollectionEntry[] | undefined): NoteListEntry[] | undefined {
  return entries?.map((entry) => ({
    path: entry.path,
    title: entry.title,
    snippet: '',
    tags: [],
    mtime: entry.mtime,
    isPinned: entry.isPinned,
  }))
}

/**
 * Live Collection widget for one ` ```collection ` fence in a note. The fence
 * stays in the markdown (portable, editable); this is the rendered view
 * underneath the editor. Falls back to the table when the requested view
 * needs a property the tag does not declare.
 */
export function EmbeddedCollection({ embed, onChange }: EmbeddedCollectionProps): ReactElement {
  return embed.selection.kind === 'tag' ? (
    <EmbeddedTagCollection embed={embed} tag={embed.selection.tag} onChange={onChange} />
  ) : (
    <EmbeddedReusableCollection embed={embed} onChange={onChange} />
  )
}

interface EmbeddedTagCollectionProps extends EmbeddedCollectionProps {
  tag: string
}

function EmbeddedTagCollection({ embed, tag, onChange }: EmbeddedTagCollectionProps): ReactElement {
  // Every tag is a collection: a tag without a definition note embeds as
  // the zero-property table, and its "+" writes the schema in place.
  const loadedTagType = useTagType(tag)
  const tagType = loadedTagType === null ? EMPTY_TAG_TYPE : loadedTagType
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  // The fence's own arrangement seeds the widget; a header click still
  // re-sorts this render of it (the fence text is not rewritten).
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [editingSchema, setEditingSchema] = useState(false)
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const resolveTemplateValues = useTemplateValues()
  const refreshTagType = useCallback(
    () => queryClient.invalidateQueries({ queryKey: tagTypeQueryKey(graph?.root, tag) }),
    [queryClient, graph?.root, tag],
  )
  const unfiltered = useCollection(tagType === undefined ? null : tag, embed.sorts)
  const entries = useMemo(() => {
    if (unfiltered === undefined || tagType === undefined) {
      return unfiltered
    }
    // The fence's filter lines share the filter menu's vocabulary, so the
    // one applier serves both surfaces.
    return applyCollectionFilters(tagType, unfiltered, embed.filters, embed.match)
  }, [unfiltered, tagType, embed.filters, embed.match])
  // `group:` renders the fence's table with shelf rows (Plan 29 V1b) — only
  // a key the schema declares as single-valued groupable; anything else
  // stays flat, never a broken widget.
  const groups = useMemo(() => {
    if (embed.group === null || tagType === undefined) {
      return null
    }
    const property = groupablePropertiesOf(tagType.properties).find(
      (candidate) => candidate.key === embed.group,
    )
    return property === undefined || entries === undefined
      ? null
      : tableGroupRows(entries, property)
  }, [embed.group, tagType, entries])
  const orderedPaths = useMemo(
    () =>
      groups !== null
        ? groups.flatMap((group) => group.entries.map((entry) => entry.path))
        : (entries ?? []).map((entry) => entry.path),
    [groups, entries],
  )
  const selection = useListSelection(orderedPaths)

  const openNote = useCallback(
    (path: string, event?: ModClickEvent) =>
      navigateNoteLink({
        target: routeForPath(path),
        openInNewWindow: event !== undefined && isModEvent(event),
      }),
    [navigateNoteLink],
  )
  const boardProperty = tagType !== undefined ? (groupableProperties(tagType)[0] ?? null) : null
  const dateProperty = tagType !== undefined ? calendarProperty(tagType) : null
  const view: CollectionEmbedView =
    embed.view === 'board' && boardProperty === null
      ? 'table'
      : embed.view === 'calendar' && dateProperty === null
        ? 'table'
        : embed.view

  return (
    <section
      aria-label={`Collection #${tag}`}
      data-testid="collection-embed"
      data-collection-tag={foldTag(tag)}
      data-collection-view={view}
      className="mt-6 overflow-hidden rounded-lg border border-border"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">#{tag}</p>
          <p className="text-2xs text-text-muted">{VIEW_LABEL[view]}</p>
        </div>
        <button
          type="button"
          aria-label={`Open #${tag} in All Notes`}
          className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
          onClick={() => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } })}
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </button>
      </header>
      <div
        className={cn(
          'max-h-[min(28rem,70vh)] min-h-40 overflow-auto',
          view === 'table' && 'min-h-52',
        )}
      >
        {tagType === undefined ? (
          <p className="px-3 py-6 text-sm text-text-muted">Loading collection…</p>
        ) : view === 'grid' ? (
          <AllNotesGrid
            notes={gridNotes(entries)}
            tag={tag}
            type={tagType}
            entries={entries}
            onOpen={openNote}
          />
        ) : view === 'calendar' && dateProperty !== null ? (
          <CollectionCalendar
            entries={entries}
            property={dateProperty}
            tag={tag}
            type={tagType}
            onOpen={openNote}
          />
        ) : view === 'board' && boardProperty !== null ? (
          <CollectionBoard
            entries={entries}
            tag={tag}
            type={tagType}
            property={boardProperty}
            onOpen={openNote}
          />
        ) : (
          <CollectionTable
            entries={entries}
            tag={tag}
            type={tagType}
            selection={selection}
            sorts={embed.sorts}
            onSortChange={(next) => {
              onChange?.({ ...embed, sorts: next })
            }}
            columnWidths={columnWidths}
            onColumnWidthChange={(key, rem) =>
              setColumnWidths((current) => ({ ...current, [key]: rem }))
            }
            onEditSchema={() => setEditingSchema(true)}
            onAddProperty={async (name, propertyType) => {
              if (graph === null) {
                return
              }
              await addTagProperty(tag, graph.generation, name, propertyType)
              await refreshTagType()
            }}
            onDeleteProperty={async (key) => {
              if (graph === null) {
                return
              }
              await removeTagProperty(tag, graph.generation, key)
              await refreshTagType()
            }}
            onCreateRow={async (title) => {
              if (graph === null) {
                return
              }
              await createTitledCollectionNote(
                tag,
                graph.generation,
                title,
                tagType,
                await resolveTemplateValues(null),
              )
            }}
            groups={groups}
            onOpen={openNote}
            registerScrollToIndex={() => {}}
          />
        )}
      </div>
      {editingSchema ? <TagConfigDialog tag={tag} onClose={() => setEditingSchema(false)} /> : null}
    </section>
  )
}

function EmbeddedReusableCollection({ embed, onChange }: EmbeddedCollectionProps): ReactElement {
  const reference = embed.selection.kind === 'definition' ? embed.selection.reference : ''
  const state = useReusableCollection(reference, embed.sorts)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [editingDefinition, setEditingDefinition] = useState(false)
  const { graph } = useGraph()
  const navigateNoteLink = useNoteLinkNavigation()
  const resolveTemplateValues = useTemplateValues()
  const queryClient = useQueryClient()

  const openNote = useCallback(
    (path: string, event?: ModClickEvent) =>
      navigateNoteLink({
        target: routeForPath(path),
        openInNewWindow: event !== undefined && isModEvent(event),
      }),
    [navigateNoteLink],
  )
  const selectedPaths = useMemo(() => {
    if (state.status !== 'resolved') return []
    const entries = applyCollectionFilters(
      state.schema.type,
      state.rows,
      embed.filters,
      embed.match,
    )
    const groupedProperty = groupablePropertiesOf(state.schema.type.properties, true).find(
      (property) =>
        property.key === embed.group &&
        state.schema.fields.some((field) => field.key === property.key && field.editable),
    )
    return groupedProperty === undefined
      ? entries.map((entry) => entry.path)
      : tableGroupRows(entries, groupedProperty).flatMap((group) =>
          group.entries.map((entry) => entry.path),
        )
  }, [state, embed.filters, embed.match, embed.group])
  const selection = useListSelection(selectedPaths)

  if (state.status !== 'resolved') {
    const message =
      state.status === 'loading'
        ? 'Loading collection…'
        : state.status === 'ambiguous'
          ? `Collection reference “${state.reference}” is ambiguous: ${state.candidates.join(', ')}`
          : state.status === 'unresolved'
            ? `Collection “${state.reference}” could not be resolved.`
            : `Couldn’t load this collection: ${state.message}`
    return (
      <section
        aria-label="Reusable collection"
        data-testid="collection-embed"
        data-collection-reference={reference}
        data-collection-view={embed.view}
        className="mt-6 overflow-hidden rounded-lg border border-border"
      >
        <p className="px-3 py-6 text-sm text-text-muted">{message}</p>
      </section>
    )
  }

  const hidden = new Set(embed.hidden ?? [])
  const fullType = state.schema.type
  const visibleType: TagType = {
    properties: state.schema.type.properties.filter((property) => !hidden.has(property.key)),
  }
  const editableKeys = new Set(
    state.schema.fields.filter((field) => field.editable).map((field) => field.key),
  )
  const rawKeys = new Set(
    state.schema.fields.filter((field) => field.conflict !== null).map((field) => field.key),
  )
  const entries = applyCollectionFilters(fullType, state.rows, embed.filters, embed.match)
  const groupable = groupablePropertiesOf(fullType.properties, true).filter((property) =>
    editableKeys.has(property.key),
  )
  const groupedProperty = groupable.find((property) => property.key === embed.group) ?? null
  const boardProperty = groupedProperty ?? groupable[0] ?? null
  const dateProperty = calendarProperty({
    properties: fullType.properties.filter((property) => editableKeys.has(property.key)),
  })
  const groups =
    embed.group !== null && groupedProperty !== null
      ? tableGroupRows(entries, groupedProperty)
      : null
  const view = embed.view
  const collectionTag = state.definition.config.create?.tag ?? ''

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'reusable-collection', reference],
    })
  }
  const createRow = async (properties: Record<string, unknown> = {}): Promise<string | null> => {
    if (graph === null) return null
    try {
      const path = await createReusableCollectionRow({
        definition: state.definition,
        generation: graph.generation,
        properties,
        templateValues: await resolveTemplateValues(null),
      })
      await refresh()
      return path
    } catch (cause) {
      toast.add({
        type: 'error',
        title: "Couldn't create the note",
        description: cause instanceof Error ? cause.message : String(cause),
      })
      return null
    }
  }

  return (
    <section
      aria-label={`Collection ${state.definition.title}`}
      data-testid="collection-embed"
      data-collection-reference={reference}
      data-collection-view={view}
      className="mt-6 overflow-hidden rounded-lg border border-border"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="mr-auto min-w-0">
          <p className="truncate text-sm font-medium text-text">{state.definition.title}</p>
          {state.diagnostics.length > 0 ? (
            <p className="text-2xs text-amber-600">{state.diagnostics.length} unresolved source</p>
          ) : null}
        </div>
        <CollectionFilterMenu
          type={fullType}
          entries={state.rows}
          filters={embed.filters}
          onChange={(filters) => onChange?.({ ...embed, filters })}
          match={embed.match}
          onMatchChange={(match) => onChange?.({ ...embed, match })}
        />
        <Select
          value={embed.view}
          items={Object.fromEntries(VIEW_OPTIONS.map((option) => [option, VIEW_LABEL[option]]))}
          onValueChange={(next) => {
            if (typeof next === 'string' && VIEW_OPTIONS.includes(next as CollectionEmbedView)) {
              const view = next as CollectionEmbedView
              onChange?.({
                ...embed,
                view,
                group:
                  view === 'board' && embed.group === null && boardProperty !== null
                    ? boardProperty.key
                    : embed.group,
              })
            }
          }}
        >
          <SelectTrigger aria-label="Collection view" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {VIEW_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={view === 'board' ? (boardProperty?.key ?? '__none') : (embed.group ?? '__none')}
          items={Object.fromEntries([
            ...(view === 'board' ? [] : [['__none', 'No grouping']]),
            ...groupable.map((property) => [property.key, property.name]),
          ])}
          onValueChange={(next) => {
            if (typeof next === 'string') {
              onChange?.({ ...embed, group: next === '__none' ? null : next })
            }
          }}
        >
          <SelectTrigger aria-label="Group collection" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {view === 'board' ? null : <SelectItem value="__none">No grouping</SelectItem>}
            {groupable.map((property) => (
              <SelectItem key={property.key} value={property.key}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Collection columns"
            className="app-icon-button text-text-muted hover:text-text"
          >
            <Sliders aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {state.schema.type.properties.map((property) => (
              <DropdownMenuCheckboxItem
                key={property.key}
                checked={!hidden.has(property.key)}
                onCheckedChange={(checked) => {
                  const nextHidden = new Set(hidden)
                  if (checked) nextHidden.delete(property.key)
                  else nextHidden.add(property.key)
                  onChange?.({ ...embed, hidden: [...nextHidden] })
                }}
              >
                {property.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="Configure collection"
          className="app-icon-button text-text-muted hover:text-text"
          onClick={() => setEditingDefinition(true)}
        >
          <Settings aria-hidden className="size-3.5" />
        </button>
      </header>
      <div
        className={cn(
          'max-h-[min(28rem,70vh)] min-h-40 overflow-auto',
          view === 'table' && 'min-h-52',
        )}
      >
        {view === 'table' ? (
          <ReusableCollectionActions
            notes={state.notes}
            memberPaths={new Set(state.rows.map((entry) => entry.path))}
            selectedPaths={[...selection.selected]}
            onAdd={async (path) => {
              if (graph === null) return
              await addReusableCollectionMember(state.definition, path, graph.generation)
              await refresh()
            }}
            onRemove={async (paths) => {
              if (graph === null) return
              for (const path of paths) {
                await removeReusableCollectionMember(state.definition, path, graph.generation)
              }
              await refresh()
            }}
            onDone={selection.clear}
          />
        ) : null}
        {view === 'board' && boardProperty === null ? (
          <p className="px-3 py-6 text-sm text-text-muted">
            Board view needs a compatible editable property for grouping.
          </p>
        ) : view === 'calendar' && dateProperty === null ? (
          <p className="px-3 py-6 text-sm text-text-muted">
            Calendar view needs a compatible date property.
          </p>
        ) : view === 'grid' ? (
          <AllNotesGrid
            notes={gridNotes(entries)}
            tag={null}
            type={visibleType}
            entries={entries}
            onOpen={openNote}
          />
        ) : view === 'calendar' && dateProperty !== null ? (
          <CollectionCalendar
            entries={entries}
            property={dateProperty}
            tag={collectionTag}
            type={fullType}
            onCreateRow={createRow}
            onOpen={openNote}
          />
        ) : view === 'board' && boardProperty !== null ? (
          <CollectionBoard
            entries={entries}
            tag={collectionTag}
            type={fullType}
            property={boardProperty}
            onCreateRow={createRow}
            onOpen={openNote}
          />
        ) : (
          <CollectionTable
            entries={entries}
            tag={state.definition.title}
            type={visibleType}
            editableKeys={editableKeys}
            rawKeys={rawKeys}
            selection={selection}
            sorts={embed.sorts}
            onSortChange={(sorts) => onChange?.({ ...embed, sorts })}
            columnWidths={columnWidths}
            onColumnWidthChange={(key, rem) =>
              setColumnWidths((current) => ({ ...current, [key]: rem }))
            }
            onHideColumn={(key) =>
              onChange?.({ ...embed, hidden: [...new Set([...(embed.hidden ?? []), key])] })
            }
            onCreateRow={async (title) => {
              if (graph === null) return
              try {
                await createReusableCollectionRow({
                  definition: state.definition,
                  generation: graph.generation,
                  title,
                  templateValues: await resolveTemplateValues(null),
                })
                await refresh()
              } catch (cause) {
                toast.add({
                  type: 'error',
                  title: "Couldn't create the note",
                  description: cause instanceof Error ? cause.message : String(cause),
                })
              }
            }}
            groups={groups}
            onOpen={openNote}
            registerScrollToIndex={() => {}}
          />
        )}
      </div>
      {editingDefinition ? (
        <CollectionDefinitionDialog
          definition={state.definition}
          onClose={() => setEditingDefinition(false)}
          onSaved={() => {
            void refresh()
          }}
        />
      ) : null}
    </section>
  )
}
