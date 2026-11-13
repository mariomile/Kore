import type { ReactElement } from 'react'
import { propertyKeyForName, tagPropertyTypeSchema, type TagPropertyType } from '@kore/core'
import { ArrowDown, ArrowUp, Trash } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PROPERTY_TYPE_ICONS } from './property-type-icons'
import { PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'
import { TagPropertySettings } from './tag-property-settings'

export interface TagPropertyRowProps {
  draft: PropertyDraft
  /** The name is missing. */
  nameInvalid: boolean
  /** The key is malformed, reserved, or a duplicate — the editor auto-opens. */
  keyInvalid: boolean
  /** Focus the name input on mount (a freshly added row). */
  autoFocus?: boolean
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
  moveDraft: (rowId: number, delta: -1 | 1) => void
  onRemove: () => void
}

/**
 * One property's editable schema card inside the desktop type dialog: name,
 * type and the reorder/remove buttons up front, then the type's own settings
 * ({@link TagPropertySettings}).
 */
export function TagPropertyRow({
  draft,
  nameInvalid,
  keyInvalid,
  autoFocus = false,
  updateDraft,
  moveDraft,
  onRemove,
}: TagPropertyRowProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5 [--field-label-w:calc(7rem-11px)]">
      <div className="flex items-center gap-1.5">
        <Input
          value={draft.name}
          aria-label="Property name"
          aria-invalid={nameInvalid || undefined}
          placeholder="Author"
          className="flex-1"
          autoFocus={autoFocus}
          onChange={(event) => {
            const name = event.target.value
            updateDraft(draft.rowId, {
              name,
              // Follow the name until the key was edited by hand.
              ...(draft.key === propertyKeyForName(draft.name)
                ? { key: propertyKeyForName(name) }
                : {}),
            })
          }}
        />
        <Select
          value={draft.type}
          items={PROPERTY_TYPE_LABELS}
          onValueChange={(value) => {
            const parsed = tagPropertyTypeSchema.safeParse(value)
            if (parsed.success) {
              updateDraft(draft.rowId, { type: parsed.data })
            }
          }}
        >
          <SelectTrigger className="w-44 shrink-0" aria-label="Property type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => {
              const Glyph = PROPERTY_TYPE_ICONS[value as TagPropertyType]
              return (
                <SelectItem key={value} value={value}>
                  <Glyph aria-hidden className="size-3.5 text-text-muted" />
                  {label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move property up"
          onClick={() => moveDraft(draft.rowId, -1)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move property down"
          onClick={() => moveDraft(draft.rowId, 1)}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove property"
          onClick={onRemove}
        >
          <Trash className="size-4" />
        </Button>
      </div>
      <TagPropertySettings draft={draft} keyInvalid={keyInvalid} updateDraft={updateDraft} />
    </div>
  )
}
