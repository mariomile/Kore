import type { ReactElement } from 'react'
import { startingValueKinds, type StartingValueKind } from '@kore/core'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FIELD_LABEL_CLASS, type PropertyDraft } from './tag-config-drafts'

const KIND_LABELS: Record<StartingValueKind | 'none', string> = {
  none: 'None',
  today: 'Today',
  now: 'Now (day and time)',
  'next-number': 'Next number',
  fixed: 'Fixed value',
}

interface StartingValueFieldProps {
  draft: PropertyDraft
  /** The row's options, parsed, for option-typed fields. */
  options: readonly string[]
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
}

/**
 * "Starting value" (Plan 33 B4): what a note gets in this field when it
 * joins the tag through Kore. Only the kinds the type can hold are offered
 * (`startingValueKinds`); a fixed value for an option field is picked from
 * its options, for a checkbox as checked or not, else typed.
 */
export function StartingValueField({
  draft,
  options,
  updateDraft,
}: StartingValueFieldProps): ReactElement | null {
  const kinds = startingValueKinds(draft.type)
  if (kinds.length === 0) {
    return null
  }
  const kind =
    draft.startingKind !== 'none' && kinds.includes(draft.startingKind)
      ? draft.startingKind
      : 'none'
  const items = Object.fromEntries(
    (['none', ...kinds] as const).map((entry) => [entry, KIND_LABELS[entry]]),
  )
  const pickFromOptions =
    draft.type === 'select' || draft.type === 'multiselect' || draft.type === 'status'
  return (
    <div className="flex items-center gap-2">
      <span className={FIELD_LABEL_CLASS}>Starting value</span>
      <Select
        value={kind}
        items={items}
        onValueChange={(next) => {
          if (typeof next === 'string' && next in items) {
            updateDraft(draft.rowId, { startingKind: next as StartingValueKind | 'none' })
          }
        }}
      >
        <SelectTrigger className="w-44" aria-label="Starting value">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {kind === 'fixed' && draft.type === 'checkbox' ? (
        <FixedChoice
          draft={draft}
          choices={{ true: 'Checked', false: 'Unchecked' }}
          updateDraft={updateDraft}
        />
      ) : null}
      {kind === 'fixed' && pickFromOptions ? (
        <FixedChoice
          draft={draft}
          choices={Object.fromEntries(options.map((option) => [option, option]))}
          updateDraft={updateDraft}
        />
      ) : null}
      {kind === 'fixed' && draft.type !== 'checkbox' && !pickFromOptions ? (
        <Input
          value={draft.startingFixed}
          aria-label="Fixed starting value"
          type={
            draft.type === 'number' || draft.type === 'rating'
              ? 'number'
              : draft.type === 'date'
                ? 'date'
                : 'text'
          }
          className="flex-1"
          onChange={(event) => updateDraft(draft.rowId, { startingFixed: event.target.value })}
        />
      ) : null}
    </div>
  )
}

function FixedChoice({
  draft,
  choices,
  updateDraft,
}: {
  draft: PropertyDraft
  choices: Record<string, string>
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
}): ReactElement {
  const items = { __pick: 'Pick a value', ...choices }
  const value = draft.startingFixed in choices ? draft.startingFixed : '__pick'
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (typeof next === 'string') {
          updateDraft(draft.rowId, { startingFixed: next === '__pick' ? '' : next })
        }
      }}
    >
      <SelectTrigger className="flex-1" aria-label="Fixed starting value">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([entry, label]) => (
          <SelectItem key={entry} value={entry}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
