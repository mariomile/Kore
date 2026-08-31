import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  listTagTypes,
  propertyKeyForName,
  rollupAggregationSchema,
  tagPropertyTypeSchema,
  type TagPropertyType,
} from '@reflect/core'
import {
  ArrowDown,
  ArrowUp,
  ArrowUturnRight,
  Calendar,
  Chart,
  CheckCircle,
  ChevronUpDown,
  Flag,
  Graph,
  Hash,
  Inbox,
  Link,
  List,
  Paperclip,
  Pencil,
  Star,
  Trash,
  WikiLink,
  type Icon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { OptionsChipsEditor } from './options-chips-editor'
import { FIELD_LABEL_CLASS, PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'

/** One glyph per property type, so the picker reads at a glance. */
const PROPERTY_TYPE_ICONS: Record<TagPropertyType, Icon> = {
  text: Pencil,
  number: Hash,
  checkbox: CheckCircle,
  date: Calendar,
  select: ChevronUpDown,
  multiselect: List,
  url: Link,
  relation: WikiLink,
  relations: Graph,
  status: Flag,
  files: Paperclip,
  email: Inbox,
  rating: Star,
  rollup: Chart,
  reverse: ArrowUturnRight,
}

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
 * One property's editable schema row inside {@link TagConfigDialog}: name and
 * type up front, options as chips when the type carries them, and the
 * frontmatter key tucked behind a small mono chip — it follows the name on
 * its own (`propertyKeyForName`) until edited by hand, so most rows never
 * open it. An invalid key opens the editor itself, since a hidden error is
 * not an error the user can fix.
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
  const [keyEditing, setKeyEditing] = useState(false)
  const hasOptions =
    draft.type === 'select' || draft.type === 'multiselect' || draft.type === 'status'
  const isRelation = draft.type === 'relation' || draft.type === 'relations'
  const keyOpen = keyEditing || keyInvalid
  // The typed tags a relation can point at — the same rows the sidebar's Tags
  // section queries, so the cache is shared. Only fetched while the row needs
  // the selector.
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-types'],
    queryFn: () => listTagTypes(),
    enabled: (isRelation || draft.type === 'reverse') && bridgeReady && graph !== null,
  })
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
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
          <SelectTrigger className="w-36 shrink-0" aria-label="Property type">
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
      {hasOptions ? (
        <div className="flex items-start gap-1.5">
          <span className={`${FIELD_LABEL_CLASS} pt-1.5`}>Options</span>
          <OptionsChipsEditor
            value={draft.options}
            onChange={(options) => updateDraft(draft.rowId, { options })}
          />
        </div>
      ) : null}
      {isRelation ? (
        <label className="flex items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>Target</span>
          <Select
            value={draft.target === '' ? '__any' : draft.target}
            items={{
              __any: 'Any note',
              ...Object.fromEntries(
                (tagTypes ?? []).map((entry) => [entry.tagKey, `#${entry.tagKey}`]),
              ),
              ...(draft.target === '' ? {} : { [draft.target]: `#${draft.target}` }),
            }}
            onValueChange={(next) => {
              if (typeof next === 'string') {
                updateDraft(draft.rowId, { target: next === '__any' ? '' : next })
              }
            }}
          >
            <SelectTrigger className="w-44" aria-label="Relation target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any">Any note</SelectItem>
              {(tagTypes ?? [])
                .map((entry) => entry.tagKey)
                .map((tagKey) => (
                  <SelectItem key={tagKey} value={tagKey}>
                    #{tagKey}
                  </SelectItem>
                ))}
              {/* A stored target whose tag lost its type still shows, so
                  opening the dialog cannot silently drop it. */}
              {draft.target !== '' &&
              !(tagTypes ?? []).some((entry) => entry.tagKey === draft.target) ? (
                <SelectItem value={draft.target}>#{draft.target}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </label>
      ) : null}
      {draft.type === 'reverse' ? (
        <div className="flex items-center gap-1.5">
          <label className="flex flex-1 items-center gap-1.5">
            <span className={FIELD_LABEL_CLASS}>Of</span>
            <Select
              value={draft.reverseTag === '' ? '__none' : draft.reverseTag}
              items={{
                __none: 'Pick a collection',
                ...Object.fromEntries(
                  (tagTypes ?? []).map((entry) => [entry.tagKey, `#${entry.tagKey}`]),
                ),
                ...(draft.reverseTag === '' ? {} : { [draft.reverseTag]: `#${draft.reverseTag}` }),
              }}
              onValueChange={(next) => {
                if (typeof next === 'string') {
                  updateDraft(draft.rowId, { reverseTag: next === '__none' ? '' : next })
                }
              }}
            >
              <SelectTrigger className="flex-1" aria-label="Reverse collection">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(tagTypes ?? []).map((entry) => (
                  <SelectItem key={entry.tagKey} value={entry.tagKey}>
                    #{entry.tagKey}
                  </SelectItem>
                ))}
                {draft.reverseTag !== '' &&
                !(tagTypes ?? []).some((entry) => entry.tagKey === draft.reverseTag) ? (
                  <SelectItem value={draft.reverseTag}>#{draft.reverseTag}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-1 items-center gap-1.5">
            <span className={FIELD_LABEL_CLASS}>Via</span>
            <Input
              value={draft.reverseProperty}
              aria-label="Reverse relation key"
              placeholder="company"
              className="flex-1 font-mono text-xs"
              onChange={(event) =>
                updateDraft(draft.rowId, { reverseProperty: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}
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
      {keyOpen ? (
        <label className="flex items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>Key</span>
          <Input
            value={draft.key}
            aria-label="Frontmatter key"
            aria-invalid={keyInvalid || undefined}
            placeholder="author"
            className="flex-1 font-mono text-xs"
            onChange={(event) => updateDraft(draft.rowId, { key: event.target.value })}
          />
        </label>
      ) : draft.key !== '' ? (
        <button
          type="button"
          aria-label="Edit frontmatter key"
          title="The frontmatter key notes store this property under"
          onClick={() => setKeyEditing(true)}
          className="self-start font-mono text-2xs text-text-muted transition-colors hover:text-text-secondary"
        >
          key: {draft.key}
        </button>
      ) : null}
    </div>
  )
}
