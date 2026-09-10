import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  getTagType,
  listNoteTags,
  listNotes,
  resolveCollectionNoteReference,
  type CollectionDefinition,
  type CollectionDefinitionConfig,
  type CollectionValue,
  type NoteListEntry,
  type TagProperty,
  type TagType,
} from '@reflect/core'
import { Trash } from '@/components/icons'
import { PropertyFieldValue } from '@/components/tags/property-field-value'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import {
  createReusableCollectionDefinition,
  removeReusableCollectionExclusionsForPaths,
  saveReusableCollectionDefinition,
  stableCollectionReferenceForPath,
} from '@/lib/tags/reusable-collection-write'
import { useGraph } from '@/providers/graph-provider'

export interface CollectionDefinitionDialogProps {
  definition?: CollectionDefinition | undefined
  onRestoreFocus?: (() => void) | undefined
  onClose: () => void
  onSaved: (definition: CollectionDefinition) => void
}

type DefaultProperties = NonNullable<CollectionDefinitionConfig['create']>['properties']

const EMPTY_CONFIG: CollectionDefinitionConfig = {
  version: 1,
  sources: { tags: [], include: [], exclude: [] },
}

/** Configure a reusable selection using the same fields and editors as supertags. */
export function CollectionDefinitionDialog({
  definition,
  onRestoreFocus,
  onClose,
  onSaved,
}: CollectionDefinitionDialogProps): ReactElement {
  const { graph } = useGraph()
  const initial = definition?.config ?? EMPTY_CONFIG
  const [name, setName] = useState(definition?.title ?? '')
  const [tags, setTags] = useState<string[]>([...initial.sources.tags])
  const [relationKey, setRelationKey] = useState(initial.sources.relation?.key ?? '')
  const [relationPath, setRelationPath] = useState('')
  const [unresolvedRelation, setUnresolvedRelation] = useState(
    initial.sources.relation?.target ?? '',
  )
  const [includedPaths, setIncludedPaths] = useState<string[]>([])
  const [unresolvedIncludes, setUnresolvedIncludes] = useState<string[]>([])
  const [defaultTag, setDefaultTag] = useState(initial.create?.tag ?? '')
  const [defaultProperties, setDefaultProperties] = useState<DefaultProperties>({
    ...(initial.create?.properties ?? {}),
  })
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [tagTypes, setTagTypes] = useState<Record<string, TagType>>({})
  const [notes, setNotes] = useState<NoteListEntry[]>([])
  const [noteQuery, setNoteQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [facets, listed, includeResolutions, relationResolution] = await Promise.all([
          listNoteTags(),
          listNotes(),
          Promise.all(
            initial.sources.include.map((reference) => resolveCollectionNoteReference(reference)),
          ),
          initial.sources.relation === undefined
            ? Promise.resolve(null)
            : resolveCollectionNoteReference(initial.sources.relation.target),
        ])
        const loadedTypes = await Promise.all(
          facets.map(async (facet) => ({ tag: facet.tag, type: await getTagType(facet.tag) })),
        )
        if (!active) return
        const typeByTag: Record<string, TagType> = {}
        for (const entry of loadedTypes) {
          if (entry.type !== null) typeByTag[entry.tag] = entry.type
        }
        setAvailableTags(facets.map((facet) => facet.tag))
        setTagTypes(typeByTag)
        setNotes(listed.filter((note) => note.path !== definition?.path))
        setIncludedPaths(
          includeResolutions.flatMap((resolution) =>
            resolution.status === 'resolved' ? [resolution.path] : [],
          ),
        )
        setUnresolvedIncludes(
          initial.sources.include.filter(
            (_, index) => includeResolutions[index]?.status !== 'resolved',
          ),
        )
        if (relationResolution?.status === 'resolved') {
          setRelationPath(relationResolution.path)
          setUnresolvedRelation('')
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [definition?.path, initial.sources.include, initial.sources.relation])

  const relationProperties = useMemo(() => {
    const byKey = new Map<string, TagProperty>()
    const sourceTags = tags.length === 0 ? Object.keys(tagTypes) : tags
    for (const tag of sourceTags) {
      for (const property of tagTypes[tag]?.properties ?? []) {
        if (property.type === 'relation' || property.type === 'relations') {
          byKey.set(property.key, property)
        }
      }
    }
    const existing = initial.sources.relation
    if (existing !== undefined && !byKey.has(existing.key)) {
      byKey.set(existing.key, { name: existing.key, key: existing.key, type: 'relation' })
    }
    return [...byKey.values()]
  }, [initial.sources.relation, tagTypes, tags])
  const selectedRelation = relationProperties.find((property) => property.key === relationKey)
  const relationNotes = useMemo(
    () =>
      selectedRelation?.target === undefined
        ? notes
        : notes.filter((note) =>
            note.tags.some(
              (tag) => tag.toLocaleLowerCase() === selectedRelation.target?.toLocaleLowerCase(),
            ),
          ),
    [notes, selectedRelation],
  )
  const shownNotes = useMemo(() => {
    const query = noteQuery.trim().toLocaleLowerCase()
    return query === ''
      ? notes
      : notes.filter(
          (note) =>
            note.title.toLocaleLowerCase().includes(query) ||
            note.path.toLocaleLowerCase().includes(query),
        )
  }, [noteQuery, notes])
  const defaultType = defaultTag === '' ? null : (tagTypes[defaultTag] ?? null)
  const canSave =
    graph !== null &&
    !loading &&
    !saving &&
    (definition !== undefined || name.trim() !== '') &&
    (relationKey === '' || relationPath !== '' || unresolvedRelation !== '')

  const toggleTag = (tag: string): void => {
    setTags((current) =>
      current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag],
    )
  }
  const toggleIncludedPath = (path: string): void => {
    setIncludedPaths((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path],
    )
  }
  const changeDefault = (property: TagProperty, value: unknown): void => {
    setDefaultProperties((current) => {
      const next = { ...current }
      if (value === undefined) {
        delete next[property.key]
      } else if (isDefaultValue(value)) {
        next[property.key] = value
      }
      return next
    })
  }

  const save = async (): Promise<void> => {
    if (!canSave || graph === null) return
    setSaving(true)
    setError(null)
    try {
      const paths = [...new Set([...includedPaths, relationPath].filter(Boolean))]
      const references = new Map(
        await Promise.all(
          paths.map(async (path) => [path, await stableCollectionReferenceForPath(path)] as const),
        ),
      )
      const referenceFor = (path: string): string => references.get(path) ?? path
      const relationReference =
        relationPath === '' ? unresolvedRelation : referenceFor(relationPath)
      const remainingExclusions = await removeReusableCollectionExclusionsForPaths(
        initial.sources.exclude,
        includedPaths,
      )
      const config: CollectionDefinitionConfig = {
        version: 1,
        sources: {
          tags,
          ...(relationKey === '' || relationReference === ''
            ? {}
            : { relation: { key: relationKey, target: relationReference } }),
          include: [...unresolvedIncludes, ...includedPaths.map(referenceFor)],
          exclude: remainingExclusions,
        },
        ...(defaultTag === '' && Object.keys(defaultProperties).length === 0
          ? {}
          : {
              create: {
                ...(defaultTag === '' ? {} : { tag: defaultTag }),
                properties: defaultProperties,
              },
            }),
      }
      const saved =
        definition === undefined
          ? await createReusableCollectionDefinition(name, config, graph.generation)
          : { ...definition, config }
      if (definition !== undefined) {
        await saveReusableCollectionDefinition(definition.path, config, graph.generation)
      }
      onSaved(saved)
      onClose()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      toast.add({ type: 'error', title: "Couldn't save the collection", description: message })
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[min(42rem,92vw)] overflow-y-auto"
        finalFocus={
          onRestoreFocus === undefined
            ? undefined
            : () => {
                onRestoreFocus()
                return false
              }
        }
      >
        <DialogHeader>
          <DialogTitle>
            {definition === undefined ? 'Create collection' : 'Configure collection'}
          </DialogTitle>
          <DialogDescription>
            Reuse one selection of original notes. Tags are alternatives; a relation, when set, must
            also match.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">Name</span>
            <Input
              autoFocus={definition === undefined}
              value={name}
              disabled={definition !== undefined}
              onChange={(event) => setName(event.target.value)}
              placeholder="Page"
              aria-label="Collection name"
            />
          </label>
          <PickerSection label="Source tags" description="Match a note carrying any selected tag.">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {availableTags.map((tag) => (
                <label
                  key={tag}
                  className="flex min-h-8 items-center gap-2 rounded-lg px-2 hover:bg-surface-hover"
                >
                  <Checkbox checked={tags.includes(tag)} onCheckedChange={() => toggleTag(tag)} />
                  <span className="truncate text-sm">#{tag}</span>
                </label>
              ))}
            </div>
          </PickerSection>
          <PickerSection label="Relation" description="Optionally require a relation to one note.">
            <div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={relationKey || '__none'}
                  items={{
                    __none: 'No relation',
                    ...Object.fromEntries(
                      relationProperties.map((property) => [property.key, property.name]),
                    ),
                  }}
                  onValueChange={(value) => {
                    setRelationKey(value === '__none' ? '' : String(value))
                    setRelationPath('')
                    setUnresolvedRelation('')
                  }}
                >
                  <SelectTrigger aria-label="Relation property" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No relation</SelectItem>
                    {relationProperties.map((property) => (
                      <SelectItem key={property.key} value={property.key}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  disabled={relationKey === ''}
                  value={relationPath || '__none'}
                  items={{
                    __none: 'Choose a note',
                    ...Object.fromEntries(relationNotes.map((note) => [note.path, note.title])),
                  }}
                  onValueChange={(value) => {
                    setRelationPath(value === '__none' ? '' : String(value))
                    setUnresolvedRelation('')
                  }}
                >
                  <SelectTrigger aria-label="Relation target" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Choose note</SelectItem>
                    {relationNotes.map((note) => (
                      <SelectItem key={note.path} value={note.path}>
                        {note.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {unresolvedRelation === '' ? null : (
                <UnresolvedReference
                  reference={unresolvedRelation}
                  onRemove={() => {
                    setUnresolvedRelation('')
                    setRelationKey('')
                  }}
                />
              )}
            </div>
          </PickerSection>
          <PickerSection
            label="Manual notes"
            description="Include individual notes even when they do not match the sources."
          >
            <div>
              <Input
                value={noteQuery}
                onChange={(event) => setNoteQuery(event.target.value)}
                placeholder="Search notes…"
                aria-label="Search notes"
                className="mb-2"
              />
              {unresolvedIncludes.map((reference) => (
                <UnresolvedReference
                  key={reference}
                  reference={reference}
                  onRemove={() =>
                    setUnresolvedIncludes((current) =>
                      current.filter((entry) => entry !== reference),
                    )
                  }
                />
              ))}
              <div className="max-h-36 overflow-y-auto rounded-lg border border-border p-1">
                {shownNotes.map((note) => (
                  <label
                    key={note.path}
                    className="flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-surface-hover"
                  >
                    <Checkbox
                      checked={includedPaths.includes(note.path)}
                      onCheckedChange={() => toggleIncludedPath(note.path)}
                    />
                    <span className="truncate text-sm">{note.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </PickerSection>
          <PickerSection
            label="Creation defaults"
            description="Use these values when creating a note here."
          >
            <div>
              <Select
                value={defaultTag || '__none'}
                items={{
                  __none: 'No default tag',
                  ...Object.fromEntries(availableTags.map((tag) => [tag, `#${tag}`])),
                }}
                onValueChange={(value) => setDefaultTag(value === '__none' ? '' : String(value))}
              >
                <SelectTrigger aria-label="Default tag" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No default tag</SelectItem>
                  {availableTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      #{tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {defaultType === null ? null : (
                <ul className="mt-2 space-y-0.5">
                  {defaultType.properties.filter(isWritableDefault).map((property) => (
                    <li key={property.key} className="flex min-h-7 items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-[13px] text-text-muted">
                        {property.name}
                      </span>
                      <PropertyValueEditor
                        property={property}
                        value={defaultValue(defaultProperties[property.key])}
                        onCommit={(value) => changeDefault(property, value)}
                      >
                        <PropertyFieldValue
                          property={property}
                          value={defaultValue(defaultProperties[property.key])}
                        />
                      </PropertyValueEditor>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PickerSection>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {saving ? 'Saving…' : definition === undefined ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PickerSection({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactElement
}): ReactElement {
  return (
    <section className="space-y-1.5">
      <div>
        <h3 className="text-xs font-medium text-text-secondary">{label}</h3>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}

function UnresolvedReference({
  reference,
  onRemove,
}: {
  reference: string
  onRemove: () => void
}): ReactElement {
  return (
    <div className="mt-1 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
        Unavailable: {reference}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove unavailable reference ${reference}`}
        onClick={onRemove}
      >
        <Trash className="size-3.5" />
      </Button>
    </div>
  )
}

function isWritableDefault(property: TagProperty): boolean {
  return !['created', 'updated', 'rollup', 'reverse', 'formula'].includes(property.type)
}

function isDefaultValue(value: unknown): value is DefaultProperties[string] {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) &&
      value.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry)))
  )
}

function defaultValue(value: DefaultProperties[string] | undefined): CollectionValue | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value))
    return { value: JSON.stringify(value), valueType: 'list', valueNumber: value.length }
  if (typeof value === 'number')
    return { value: String(value), valueType: 'number', valueNumber: value }
  if (typeof value === 'boolean')
    return { value: String(value), valueType: 'boolean', valueNumber: null }
  return { value, valueType: 'string', valueNumber: null }
}
