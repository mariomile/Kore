import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  tagPropertyTypeSchema,
  type CollectionValue,
  type TagProperty,
  type TagPropertyType,
} from '@kore/core'
import { readCellValue } from '@/components/all-notes/collection-cell'
import { ChevronDown, Plus } from '@/components/icons'
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
import { useHiddenNoteFields } from '@/lib/tags/use-hidden-note-fields'
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

/**
 * A field with nothing to read. Checkboxes never count: unchecked is an answer,
 * and folding a toggle away would turn one tap into two.
 */
function isEmptyField(property: TagProperty, value: CollectionValue | undefined): boolean {
  if (property.type === 'checkbox') {
    return false
  }
  if (value === undefined) {
    return true
  }
  const reading = readCellValue(property, value)
  return !reading.mismatch && reading.text === ''
}

interface FieldFold {
  /** The fields listed while folded: filled and not hidden by the vault. */
  shown: TagProperty[]
  /** The toggle's folded label: `3 empty`, `2 hidden`, or `5 more` for both. */
  label: string
}

/**
 * Split the note's fields into what the panel lists and what folds behind its
 * toggle: empty fields, and fields the vault hides from every note (Notion's
 * "Hide in page"). A hidden field folds even with a value; it never vanishes.
 */
function foldFields(
  properties: readonly TagProperty[],
  values: Record<string, CollectionValue> | undefined,
  hidden: ReadonlySet<string>,
): FieldFold {
  let empty = 0
  let hiddenCount = 0
  const shown: TagProperty[] = []
  for (const property of properties) {
    if (hidden.has(property.key)) {
      hiddenCount += 1
    } else if (isEmptyField(property, values?.[property.key])) {
      empty += 1
    } else {
      shown.push(property)
    }
  }
  const label =
    hiddenCount === 0
      ? `${empty} empty`
      : empty === 0
        ? `${hiddenCount} hidden`
        : `${empty + hiddenCount} more`
  return { shown, label }
}

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
 * properties with rich typed faces, loose frontmatter properties after a
 * little air, and an inline `+ Add a property` action. Empty fields and
 * fields the vault hides fold behind one quiet toggle, so the panel reads as
 * what the note says, not as the form its type could fill; long text wraps in
 * full. On iPhone every value tap opens the animated `MobileCellEditorDrawer` bottom sheet instead
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
  const { hidden, setHidden } = useHiddenNoteFields()
  // Which note the folded fields were opened on: opening another note folds
  // them again without an effect to reset the flag.
  const [unfoldedOn, setUnfoldedOn] = useState<string | null>(null)
  const unfolded = unfoldedOn === path

  const fold = foldFields(properties, values, hidden)
  const listed = unfolded ? properties : fold.shown
  const foldedCount = properties.length - fold.shown.length
  const schemaProperties = listed.filter((property) => ownerTagOf(property.key) !== null)
  const looseProperties = listed.filter((property) => ownerTagOf(property.key) === null)
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
      <li key={property.key} className="flex items-start gap-2 py-0.5">
        <PropertyFieldLabel
          property={property}
          ownerTag={ownerTagOf(property.key)}
          hidden={hidden.has(property.key)}
          onHiddenChange={(next) => setHidden(property.key, next)}
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
            variant="panel"
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
          <li aria-hidden className="h-2" />
        ) : null}
        {looseProperties.map(renderRow)}
        {primaryTag !== undefined || foldedCount > 0 ? (
          <li className="flex items-center gap-1 pt-1">
            {primaryTag === undefined ? null : mobile ? (
              <button
                type="button"
                onClick={() => {
                  setAddingMobile(true)
                }}
                className={footerActionClass(mobile)}
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
            {foldedCount > 0 ? (
              <button
                type="button"
                aria-expanded={unfolded}
                onClick={() => {
                  setUnfoldedOn(unfolded ? null : path)
                }}
                className={footerActionClass(mobile)}
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'shrink-0 transition-transform duration-150',
                    mobile ? 'size-4' : 'size-3.5',
                    !unfolded && '-rotate-90',
                  )}
                />
                <span>{unfolded ? 'Show less' : fold.label}</span>
              </button>
            ) : null}
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

/** The quiet ghost actions under the fields: Add a property, N empty. */
function footerActionClass(mobile: boolean): string {
  return cn(
    'flex items-center gap-2 rounded-md px-1.5 text-text-muted transition-colors',
    mobile
      ? 'min-h-11 text-[14px] active:bg-surface-hover active:text-text'
      : 'min-h-7 text-[13px] hover:bg-surface-hover hover:text-text',
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
      <PopoverTrigger aria-label="Add a property" className={footerActionClass(false)}>
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
