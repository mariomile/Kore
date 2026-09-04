import { useState, type FormEvent, type ReactElement } from 'react'
import { tagPropertyTypeSchema, type TagPropertyType } from '@reflect/core'
import { Plus } from '@/components/icons'
import { PROPERTY_TYPE_LABELS } from '@/components/tags/tag-config-drafts'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AddPropertyPopoverProps {
  /** Append a property to the tag's schema; rejects with a message to show. */
  onAdd: (name: string, type: TagPropertyType) => Promise<void>
  /** Open the full schema dialog — options, targets, rollups, formulas. */
  onEditSchema: () => void
}

/**
 * The types a column can be born as from the header alone. The derived and
 * configured types (rollup, reverse, formula) need the dialog: they are not
 * a name and a type, they are a small program.
 */
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

/**
 * The table header's "+": a name and a type, Enter, and the column exists —
 * the Notion gesture. "More options" hands the rest to the schema dialog.
 */
export function AddPropertyPopover({ onAdd, onEditSchema }: AddPropertyPopoverProps): ReactElement {
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

  const submit = async (event: FormEvent): Promise<void> => {
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
        aria-label="Add property"
        title="Add a property"
        className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-secondary"
      >
        <Plus aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5">
          <Input
            autoFocus
            aria-label="Property name"
            placeholder="Property name"
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
