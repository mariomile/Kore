import { useState, type ReactElement } from 'react'
import {
  propertyKeyForName,
  QUICK_PROPERTY_TYPES,
  tagPropertyTypeSchema,
  type TagPropertyType,
} from '@kore/core'
import { Trash } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PROPERTY_TYPE_ICONS } from './property-type-icons'
import { PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'
import { TagPropertySettings } from './tag-property-settings'
import type { TagConfigDraft } from './use-tag-config-draft'

/** The types every field page offers first; the rest sit under "More". */
const ADVANCED_TYPES: readonly TagPropertyType[] = tagPropertyTypeSchema.options.filter(
  (type) => !QUICK_PROPERTY_TYPES.includes(type),
)

/**
 * One field of a type on the phone ({@link TagConfigSheet}'s second page):
 * its name in a large input, its type picked from a grid of big targets (the
 * everyday ones first, the rest one tap away), then the type's own settings,
 * the same ones the desktop dialog shows ({@link TagPropertySettings}).
 */
export function TagFieldPage({
  draft,
  config,
  onRemove,
}: {
  draft: PropertyDraft
  config: TagConfigDraft
  onRemove: () => void
}): ReactElement {
  const [showAll, setShowAll] = useState(ADVANCED_TYPES.includes(draft.type))
  const types = showAll ? [...QUICK_PROPERTY_TYPES, ...ADVANCED_TYPES] : QUICK_PROPERTY_TYPES
  const nameInvalid = config.invalidNameRowIds.has(draft.rowId)

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-xs font-medium uppercase tracking-wide text-text-muted">
          Name
        </span>
        <Input
          value={draft.name}
          aria-label="Field name"
          aria-invalid={nameInvalid || undefined}
          placeholder="Stage"
          autoFocus={config.focusRowId === draft.rowId && draft.name === ''}
          className="h-12 rounded-xl text-base"
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
      </label>

      <section className="flex flex-col gap-1.5">
        <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-text-muted">Type</h3>
        <div role="radiogroup" aria-label="Field type" className="grid grid-cols-3 gap-2">
          {types.map((type) => {
            const Glyph = PROPERTY_TYPE_ICONS[type]
            const selected = draft.type === type
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => config.updateDraft(draft.rowId, { type })}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-xs transition-colors',
                  selected
                    ? 'border-primary bg-primary/10 text-text'
                    : 'border-border bg-surface text-text-secondary active:bg-surface-hover',
                )}
              >
                <Glyph aria-hidden className="size-5" />
                <span className="truncate">{PROPERTY_TYPE_LABELS[type]}</span>
              </button>
            )
          })}
        </div>
        {showAll ? null : (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="self-start px-1 py-2 text-sm text-primary"
          >
            More types (formula, rollup, created…)
          </button>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 [--field-label-w:6.5rem]">
        <TagPropertySettings
          draft={draft}
          keyInvalid={config.invalidKeyRowIds.has(draft.rowId)}
          updateDraft={config.updateDraft}
        />
      </section>

      <Button
        type="button"
        variant="ghost"
        className="h-12 gap-2 rounded-xl text-base text-destructive"
        onClick={onRemove}
      >
        <Trash aria-hidden className="size-4" />
        Delete field
      </Button>
    </>
  )
}
