import { useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { NoteTypedProperties } from '@/lib/tags/use-note-typed-properties'

/** Last segment of a nested tag (`Domain/ai` → `ai`): the phone row is narrow. */
function tagLeaf(tag: string): string {
  const parts = tag.split('/')
  return parts[parts.length - 1] || tag
}

/** A short plain-text rendering of a stored value, or `null` when empty. */
function valueText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return value.replaceAll(/^\[\[|\]\]$/g, '')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const items = value.map(valueText).filter((item): item is string => item !== null)
    return items.length === 0 ? null : items.join(', ')
  }
  return null
}

const TAG_TINTS = [
  'bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]',
  'bg-[color-mix(in_oklab,#34c759_16%,transparent)]',
  'bg-[color-mix(in_oklab,#ff9500_16%,transparent)]',
  'bg-[color-mix(in_oklab,#ff2d55_14%,transparent)]',
]

interface NoteFieldSummaryProps {
  fields: NoteTypedProperties
  /** The full, editable field list shown when the row is expanded. */
  children: ReactNode
}

/**
 * Phone-only folded properties (iPhone design pass, 2026-11):
 * the note's types as tinted chips and its first values as one muted line, so
 * the body starts right under the title. A tap on the row unfolds the full
 * editable field list.
 */
export function NoteFieldSummary({ fields, children }: NoteFieldSummaryProps): ReactElement {
  const [open, setOpen] = useState(false)
  const values = fields.properties
    .map((property) => valueText(fields.values?.[property.key]))
    .filter((text): text is string => text !== null)
    .slice(0, 2)

  return (
    <section aria-label="Properties" className="mb-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 text-left text-[13px] font-medium text-text-muted"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {fields.tags.map((entry, index) => (
            <span
              key={entry.tagKey}
              className={cn(
                'rounded-full px-2 py-1 text-text',
                TAG_TINTS[index % TAG_TINTS.length],
              )}
            >
              # {tagLeaf(entry.tag)}
            </span>
          ))}
          {values.length > 0 ? (
            <span className="min-w-0 truncate pl-0.5">{values.join(' · ')}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? <div className="mt-3 border-b border-border pb-4">{children}</div> : null}
    </section>
  )
}
