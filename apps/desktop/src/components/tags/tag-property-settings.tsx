import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listNoteTags, listTagTypes, rollupAggregationSchema } from '@kore/core'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { allNotesTagsQueryKey } from '@/lib/notes/all-notes-query'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { OptionsChipsEditor } from './options-chips-editor'
import { StartingValueField } from './starting-value-field'
import {
  FIELD_LABEL_CLASS,
  relationTargetSelectItems,
  relationTargetTags,
  type PropertyDraft,
} from './tag-config-drafts'

/** Capitalized once, for both the menu and the closed trigger. */
const ROLLUP_AGGREGATION_LABELS = Object.fromEntries(
  rollupAggregationSchema.options.map((aggregation) => [
    aggregation,
    aggregation.charAt(0).toUpperCase() + aggregation.slice(1),
  ]),
)

export interface TagPropertySettingsProps {
  draft: PropertyDraft
  /** The key is malformed, reserved, or a duplicate: the editor auto-opens. */
  keyInvalid: boolean
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
}

/**
 * What a property needs beyond its name and type: options as chips when the
 * type carries them, the starting value, a relation's target, a formula, a
 * reverse relation or rollup's wiring, and the frontmatter key tucked behind
 * a small mono chip. It follows the name on its own (`propertyKeyForName`)
 * until edited by hand, so most rows never open it; an invalid key opens the
 * editor itself, since a hidden error is not an error the user can fix.
 * Shared by the desktop dialog's property card and the phone's field page.
 */
export function TagPropertySettings({
  draft,
  keyInvalid,
  updateDraft,
}: TagPropertySettingsProps): ReactElement {
  const [keyEditing, setKeyEditing] = useState(false)
  const hasOptions =
    draft.type === 'select' || draft.type === 'multiselect' || draft.type === 'status'
  const isRelation = draft.type === 'relation' || draft.type === 'relations'
  const keyOpen = keyEditing || keyInvalid
  // Relation targets are every tag the sidebar lists, plus typed collections
  // that don't have rows yet. `listTagTypes` alone misses a tag that exists
  // on notes but has no `tags/<name>.md` yet (Amendment A).
  const needsTargets = isRelation || draft.type === 'reverse'
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data: noteTags } = useQuery({
    queryKey: allNotesTagsQueryKey(graph?.root),
    queryFn: () => listNoteTags(),
    enabled: needsTargets && bridgeReady && graph !== null,
  })
  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-types'],
    queryFn: () => listTagTypes(),
    enabled: needsTargets && bridgeReady && graph !== null,
  })
  const targetTags = relationTargetTags(
    noteTags ?? [],
    (tagTypes ?? []).map((entry) => entry.tagKey),
  )
  return (
    <>
      {hasOptions ? (
        <div className="flex items-start gap-2">
          <span className={FIELD_LABEL_CLASS}>Options</span>
          <OptionsChipsEditor
            value={draft.options}
            onChange={(options) => updateDraft(draft.rowId, { options })}
          />
        </div>
      ) : null}
      <StartingValueField
        draft={draft}
        options={draft.options
          .split(',')
          .map((option) => option.trim())
          .filter((option) => option !== '')}
        updateDraft={updateDraft}
      />
      {isRelation ? (
        <label className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>Target</span>
          <Select
            value={draft.target === '' ? '__any' : draft.target}
            items={{
              __any: 'Any note',
              ...relationTargetSelectItems(targetTags, draft.target),
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
              {targetTags.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  #{entry.label}
                </SelectItem>
              ))}
              {/* A stored target whose tag is gone still shows, so opening
                  the dialog cannot silently drop it. */}
              {draft.target !== '' && !targetTags.some((entry) => entry.key === draft.target) ? (
                <SelectItem value={draft.target}>#{draft.target}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </label>
      ) : null}
      {draft.type === 'formula' ? (
        <label className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>Expression</span>
          <Input
            value={draft.formulaExpression}
            aria-label="Formula expression"
            placeholder='prop("price") * 1.22'
            className="flex-1 font-mono text-xs"
            onChange={(event) =>
              updateDraft(draft.rowId, { formulaExpression: event.target.value })
            }
          />
        </label>
      ) : null}
      {draft.type === 'reverse' ? (
        <>
          <label className="flex items-center gap-2">
            <span className={FIELD_LABEL_CLASS}>Of</span>
            <Select
              value={draft.reverseTag === '' ? '__none' : draft.reverseTag}
              items={{
                __none: 'Pick a collection',
                ...relationTargetSelectItems(targetTags, draft.reverseTag),
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
                {targetTags.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    #{entry.label}
                  </SelectItem>
                ))}
                {draft.reverseTag !== '' &&
                !targetTags.some((entry) => entry.key === draft.reverseTag) ? (
                  <SelectItem value={draft.reverseTag}>#{draft.reverseTag}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2">
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
        </>
      ) : null}
      {draft.type === 'rollup' ? (
        <>
          <label className="flex items-center gap-2">
            <span className={FIELD_LABEL_CLASS}>Relation</span>
            <Input
              value={draft.rollupRelation}
              aria-label="Rollup relation key"
              placeholder="author"
              className="flex-1 font-mono text-xs"
              onChange={(event) => updateDraft(draft.rowId, { rollupRelation: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className={FIELD_LABEL_CLASS}>Property</span>
            <Input
              value={draft.rollupProperty}
              aria-label="Rollup property key"
              placeholder="rating"
              className="flex-1 font-mono text-xs"
              onChange={(event) => updateDraft(draft.rowId, { rollupProperty: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className={FIELD_LABEL_CLASS}>Aggregation</span>
            <Select
              value={draft.rollupAggregation}
              items={ROLLUP_AGGREGATION_LABELS}
              onValueChange={(value) => {
                const parsed = rollupAggregationSchema.safeParse(value)
                if (parsed.success) {
                  updateDraft(draft.rowId, { rollupAggregation: parsed.data })
                }
              }}
            >
              <SelectTrigger className="w-44" aria-label="Rollup aggregation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLLUP_AGGREGATION_LABELS).map(([aggregation, label]) => (
                  <SelectItem key={aggregation} value={aggregation}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </>
      ) : null}
      {keyOpen ? (
        <label className="flex items-center gap-2">
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
    </>
  )
}
