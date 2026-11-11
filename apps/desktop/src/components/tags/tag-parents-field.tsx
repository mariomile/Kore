import type { ReactElement } from 'react'
import { Close } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FIELD_LABEL_CLASS } from './tag-config-drafts'

interface TagParentsFieldProps {
  /** The tag being configured, folded. */
  tag: string
  /** The tags it builds on now (folded keys, in order). */
  parents: readonly string[]
  /** The typed tags it may pick: not itself, not one that builds on it. */
  candidates: readonly string[]
  onChange: (parents: string[]) => void
}

/** The value the "add a parent" select rests on between picks. */
const ADD_PLACEHOLDER = '__add'

/**
 * "Builds on" (Plan 33 B2): the tags whose fields this one inherits, stored
 * as `extends:` on the definition. Inherited fields are not copied into this
 * tag's own list below; they show on the notes and in the collection. The
 * candidates leave out the tags that would close a loop, and the save
 * refuses one anyway.
 */
export function TagParentsField({
  tag,
  parents,
  candidates,
  onChange,
}: TagParentsFieldProps): ReactElement | null {
  const addable = candidates.filter((candidate) => !parents.includes(candidate))
  if (parents.length === 0 && addable.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span className={FIELD_LABEL_CLASS}>Builds on</span>
        <div className="flex min-h-8 flex-1 flex-wrap items-center gap-1.5">
          {parents.map((parent) => (
            <span
              key={parent}
              className="flex items-center gap-1 rounded-md bg-surface-hover py-0.5 pl-2 pr-1 text-xs text-text"
            >
              #{parent}
              <button
                type="button"
                aria-label={`Stop building on #${parent}`}
                className="app-icon-button text-text-muted hover:text-text"
                onClick={() => onChange(parents.filter((entry) => entry !== parent))}
              >
                <Close aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          {addable.length > 0 ? (
            <Select
              value={ADD_PLACEHOLDER}
              items={{
                [ADD_PLACEHOLDER]: parents.length === 0 ? 'Pick a tag…' : 'Add…',
                ...Object.fromEntries(addable.map((candidate) => [candidate, `#${candidate}`])),
              }}
              onValueChange={(value) => {
                if (typeof value === 'string' && value !== ADD_PLACEHOLDER) {
                  onChange([...parents, value])
                }
              }}
            >
              <SelectTrigger aria-label={`Tag #${tag} builds on`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {addable.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    #{candidate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>
      {parents.length > 0 ? (
        <p className="pl-30 text-xs text-text-muted">
          Notes tagged #{tag} also get the fields of{' '}
          {parents.map((parent) => `#${parent}`).join(', ')}, and they show in{' '}
          {parents.length === 1 ? 'its' : 'their'} collection.
        </p>
      ) : null}
    </div>
  )
}
