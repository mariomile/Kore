import type { ReactElement } from 'react'
import { propertyKeyForName, rollupAggregationSchema, tagPropertyTypeSchema } from '@reflect/core'
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
import { FIELD_LABEL_CLASS, PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'

export interface TagPropertyRowProps {
  draft: PropertyDraft
  invalid: boolean
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
  moveDraft: (rowId: number, delta: -1 | 1) => void
  onRemove: () => void
}

/** One property's editable schema row inside {@link TagConfigDialog}. */
export function TagPropertyRow({
  draft,
  invalid,
  updateDraft,
  moveDraft,
  onRemove,
}: TagPropertyRowProps): ReactElement {
  const hasOptions =
    draft.type === 'select' || draft.type === 'multiselect' || draft.type === 'status'
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1.5">
        <Input
          value={draft.name}
          aria-label="Property name"
          aria-invalid={invalid || undefined}
          placeholder="Author"
          className="flex-1"
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
          <SelectTrigger className="w-32 shrink-0" aria-label="Property type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
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
      <div className="flex items-center gap-1.5">
        <label className="flex flex-1 items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>Key</span>
          <Input
            value={draft.key}
            aria-label="Frontmatter key"
            aria-invalid={invalid || undefined}
            placeholder="author"
            className="flex-1 font-mono text-xs"
            onChange={(event) => updateDraft(draft.rowId, { key: event.target.value })}
          />
        </label>
        {hasOptions ? (
          <label className="flex flex-[2] items-center gap-1.5">
            <span className={FIELD_LABEL_CLASS}>Options</span>
            <Input
              value={draft.options}
              aria-label="Options (comma-separated)"
              placeholder="to-read, reading, done"
              className="flex-1"
              onChange={(event) => updateDraft(draft.rowId, { options: event.target.value })}
            />
          </label>
        ) : null}
      </div>
      {draft.type === 'rollup' ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <label className="flex flex-1 items-center gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Relation</span>
              <Input
                value={draft.rollupRelation}
                aria-label="Rollup relation key"
                placeholder="author"
                className="flex-1 font-mono text-xs"
                onChange={(event) =>
                  updateDraft(draft.rowId, { rollupRelation: event.target.value })
                }
              />
            </label>
            <label className="flex flex-1 items-center gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Property</span>
              <Input
                value={draft.rollupProperty}
                aria-label="Rollup property key"
                placeholder="rating"
                className="flex-1 font-mono text-xs"
                onChange={(event) =>
                  updateDraft(draft.rowId, { rollupProperty: event.target.value })
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-1.5">
            <span className={FIELD_LABEL_CLASS}>Aggregation</span>
            <Select
              value={draft.rollupAggregation}
              onValueChange={(value) => {
                const parsed = rollupAggregationSchema.safeParse(value)
                if (parsed.success) {
                  updateDraft(draft.rowId, { rollupAggregation: parsed.data })
                }
              }}
            >
              <SelectTrigger className="w-40" aria-label="Rollup aggregation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rollupAggregationSchema.options.map((aggregation) => (
                  <SelectItem key={aggregation} value={aggregation}>
                    {aggregation.charAt(0).toUpperCase() + aggregation.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
