import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tagPropertyTypeSchema, type TagProperty, type TagPropertyType } from '@kore/core'
import { Plus } from '@/components/icons'
import { PropertyFieldLabel } from '@/components/notes/property-field-label'
import { PropertyFieldValue } from '@/components/tags/property-field-value'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { PROPERTY_TYPE_LABELS } from '@/components/tags/tag-config-drafts'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { tagTypeQueryKey } from '@/hooks/use-tag-type'
import { isMobileSurface } from '@/lib/platform-surface'
import { addTagProperty } from '@/lib/tags/schema-edits'
import {
  invalidateOnNextIndexApply,
  useCommitNoteProperty,
} from '@/lib/tags/use-commit-note-property'
import type { NoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { cn } from '@/lib/utils'
import {
  MobileCellEditorDrawer,
  type MobileCellTarget,
} from '@/mobile/collection/mobile-cell-editor-drawer'
import { haptic } from '@/lib/haptics'
import { useGraph } from '@/providers/graph-provider'
import { NoteTypeField } from './note-type-field'
import { MobileAddPropertySheet } from './property-label-sheet'

const READ_ONLY_TYPES: ReadonlySet<TagPropertyType> = new Set([
  'rollup',
  'reverse',
  'formula',
  'created',
  'updated',
])

const INLINE_TYPES: readonly TagPropertyType[] = [
  'text',
  'number',
  'checkbox',
  'date',
  'select',
  'multiselect',
  'status',
  'url',
  'email',
  'phone',
  'rating',
  'relation',
  'relations',
  'person',
  'files',
  'created',
  'updated',
]

const INLINE_TYPE_LABELS = Object.fromEntries(
  INLINE_TYPES.map((type) => [type, PROPERTY_TYPE_LABELS[type]]),
) as Record<TagPropertyType, string>

interface NoteFieldListProps {
  /** Graph-relative path of the note whose fields are listed. */
  path: string
  fields: NoteTypedProperties
  /** Width of the label column: the header uses `w-32`, the rail `w-24`. */
  labelClassName: string
  /** Which edge the value editors' popovers align to. */
  align?: 'start' | 'end'
}

/**
 * A note's fields as Notion-style property rows: the Tags row, schema-owned
 * properties with rich typed faces, loose frontmatter properties below a
 * quiet divider, and an inline `+ Add a property` action. On iPhone every
 * value tap opens the animated `MobileCellEditorDrawer` bottom sheet instead
 * of a tiny desktop popover.
 */
export function NoteFieldList({
  path,
  fields: { tags, tagTypes, properties, values, ownerTagOf },
  labelClassName,
  align,
}: NoteFieldListProps): ReactElement {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  const mobile = isMobileSurface()
  const [editingCell, setEditingCell] = useState<MobileCellTarget | null>(null)
  const [addingMobile, setAddingMobile] = useState(false)
  const [configuringTag, setConfiguringTag] = useState<string | null>(null)

  const schemaProperties = properties.filter((property) => ownerTagOf(property.key) !== null)
  const looseProperties = properties.filter((property) => ownerTagOf(property.key) === null)
  const primaryTag =
    tagTypes[0] !== undefined
      ? (tags.find((entry) => entry.tagKey === tagTypes[0]?.tagKey)?.tag ?? tagTypes[0].tagKey)
      : tags[0]?.tag

  const handleAddProperty = async (name: string, type: TagPropertyType): Promise<void> => {
    if (primaryTag === undefined || graph === null) {
      return
    }
    await addTagProperty(primaryTag, graph.generation, name, type)
    invalidateOnNextIndexApply()
    await queryClient.invalidateQueries({ queryKey: tagTypeQueryKey(graph.root, primaryTag) })
  }

  const noteTitle = (path.split('/').pop() ?? path).replace(/\.md$/i, '')

  const renderRow = (property: TagProperty): ReactElement => {
    const value = values?.[property.key]
    const readOnly = READ_ONLY_TYPES.has(property.type)
    const isCheckbox = property.type === 'checkbox'
    const checked = value?.valueType === 'boolean' && value.value === 'true'
    return (
      <li
        key={property.key}
        className={cn('flex items-center gap-2', mobile ? 'min-h-10' : 'min-h-8')}
      >
        <PropertyFieldLabel
          property={property}
          ownerTag={ownerTagOf(property.key)}
          className={labelClassName}
        />
        {mobile ? (
          readOnly ? (
            <div className="flex min-w-0 flex-1 items-center">
              <PropertyFieldValue property={property} value={value} onOpenRelation={openRelation} />
            </div>
          ) : isCheckbox ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={property.name}
              onClick={() => {
                haptic('toggle')
                commitProperty(path, property.key, !checked)
              }}
              className="flex min-w-0 flex-1 items-center text-left focus-visible:outline-none"
            >
              <PropertyFieldValue property={property} value={value} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Edit ${property.name}`}
              onClick={() => {
                setEditingCell({
                  entryPath: path,
                  entryTitle: noteTitle,
                  property,
                  value,
                })
              }}
              className="flex min-w-0 flex-1 items-center text-left focus-visible:outline-none"
            >
              <PropertyFieldValue property={property} value={value} onOpenRelation={openRelation} />
            </button>
          )
        ) : (
          <PropertyValueEditor
            property={property}
            value={value}
            onCommit={(next) => commitProperty(path, property.key, next)}
            onOpenRelation={openRelation}
            {...(align === undefined ? {} : { align })}
          >
            <PropertyFieldValue property={property} value={value} onOpenRelation={openRelation} />
          </PropertyValueEditor>
        )}
      </li>
    )
  }

  return (
    <>
      <ul className={cn(mobile ? 'space-y-0.5' : 'space-y-0.5')}>
        <NoteTypeField path={path} tags={tags} labelClassName={labelClassName} />
        {schemaProperties.map(renderRow)}
        {schemaProperties.length > 0 && looseProperties.length > 0 ? (
          <li aria-hidden className="my-1.5 border-t border-border/70" />
        ) : null}
        {looseProperties.map(renderRow)}
        {primaryTag !== undefined ? (
          <li className="pt-1">
            {mobile ? (
              <button
                type="button"
                onClick={() => {
                  setAddingMobile(true)
                }}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-[14px] text-text-muted transition-colors active:bg-surface-hover active:text-text"
              >
                <Plus aria-hidden className="size-4 shrink-0" />
                <span>Add a property</span>
              </button>
            ) : (
              <DesktopAddPropertyRow
                tag={primaryTag}
                onAdd={handleAddProperty}
                onEditSchema={() => setConfiguringTag(primaryTag)}
              />
            )}
          </li>
        ) : null}
      </ul>

      {mobile ? (
        <MobileCellEditorDrawer
          target={editingCell}
          onClose={() => setEditingCell(null)}
          onCommit={commitProperty}
          onOpenRelation={openRelation}
        />
      ) : null}
      {mobile && primaryTag !== undefined ? (
        <MobileAddPropertySheet
          open={addingMobile}
          onOpenChange={setAddingMobile}
          tag={primaryTag}
          onAdd={handleAddProperty}
          onEditSchema={() => setConfiguringTag(primaryTag)}
        />
      ) : null}
      {configuringTag !== null ? (
        <TagConfigDialog tag={configuringTag} onClose={() => setConfiguringTag(null)} />
      ) : null}
    </>
  )
}

function DesktopAddPropertyRow({
  tag,
  onAdd,
  onEditSchema,
}: {
  tag: string
  onAdd: (name: string, type: TagPropertyType) => Promise<void>
  onEditSchema: () => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<TagPropertyType>('text')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = (): void => {
    setName('')
    setType('text')
    setError(null)
    setSaving(false)
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || saving) {
      return
    }
    setSaving(true)
    try {
      await onAdd(name, type)
      setOpen(false)
      reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          reset()
        }
      }}
    >
      <PopoverTrigger
        aria-label="Add a property"
        className="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <Plus aria-hidden className="size-3.5 shrink-0" />
        <span>Add a property</span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-64 p-2">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5">
          <Input
            autoFocus
            aria-label="Property name"
            placeholder={`New #${tag} property`}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            className="h-7 text-sm"
          />
          <Select
            value={type}
            items={INLINE_TYPE_LABELS}
            onValueChange={(value) => {
              const parsed = tagPropertyTypeSchema.safeParse(value)
              if (parsed.success) {
                setType(parsed.data)
              }
            }}
          >
            <SelectTrigger aria-label="Property type" data-size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INLINE_TYPES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {PROPERTY_TYPE_LABELS[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                reset()
                onEditSchema()
              }}
              className="text-xs text-text-muted transition-colors hover:text-text"
            >
              More options…
            </button>
            <button
              type="submit"
              disabled={name.trim() === '' || saving}
              className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-soft-text transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
