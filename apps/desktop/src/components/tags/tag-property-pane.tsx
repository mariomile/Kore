import type { ReactElement } from 'react'
import { propertyKeyForName, tagPropertyTypeSchema, type TagPropertyType } from '@kore/core'
import { Trash } from '@/components/icons'
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
import { DELETE_PROPERTY_HINT } from './removed-property-notice'
import { PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'
import { TagPropertySettings } from './tag-property-settings'
import type { TagConfigDraft } from './use-tag-config-draft'

/** The Mac type settings' right pane for one property: name, type, its settings, delete. */
export function PropertyPane({
  draft,
  config,
  onRemove,
}: {
  draft: PropertyDraft
  config: TagConfigDraft
  onRemove: () => void
}): ReactElement {
  const nameInvalid = config.invalidNameRowIds.has(draft.rowId)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={draft.name}
          aria-label="Property name"
          aria-invalid={nameInvalid || undefined}
          placeholder="Property name"
          autoFocus={config.focusRowId === draft.rowId}
          className="h-9 flex-1 text-base font-medium"
          onChange={(event) => {
            const name = event.target.value
            config.updateDraft(draft.rowId, {
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
              config.updateDraft(draft.rowId, { type: parsed.data })
            }
          }}
        >
          <SelectTrigger className="h-9 w-44 shrink-0" aria-label="Property type">
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
      </div>
      <div className="flex flex-col gap-3 pt-1">
        <TagPropertySettings
          tag={config.tag}
          draft={draft}
          keyInvalid={config.invalidKeyRowIds.has(draft.rowId)}
          updateDraft={config.updateDraft}
        />
      </div>
      <div className="pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive"
          onClick={onRemove}
        >
          <Trash aria-hidden className="size-3.5" />
          Delete property
        </Button>
        {draft.originalKey === null ? null : (
          <p className="px-2.5 pt-1 text-xs text-text-muted">{DELETE_PROPERTY_HINT}</p>
        )}
      </div>
    </div>
  )
}
