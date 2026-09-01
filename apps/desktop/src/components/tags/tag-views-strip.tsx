import type { ReactElement } from 'react'
import type { TagProperty } from '@reflect/core'
import { Calendar, Layers, LayoutTemplate, type Icon } from '@/components/icons'
import { boardGroupablePropertiesOf, calendarPropertyOf } from '@/lib/tags/schema-views'
import { FIELD_LABEL_CLASS } from './tag-config-drafts'

interface TagViewsStripProps {
  /** The live draft schema (partial rows included — availability is type-based). */
  properties: readonly TagProperty[]
}

interface ViewPill {
  label: string
  Glyph: Icon
  /** The property that powers the view, when one does. */
  poweredBy: string | null
  on: boolean
  /** What the schema still needs, shown while the view is off. */
  hint: string
}

/**
 * Live feedback under the schema editor: which collection views these
 * properties unlock, and — while one is still dark — exactly what to add.
 * Availability comes from the same predicates the board and calendar use
 * (`schema-views.ts`), so the teaching here can never drift from the truth.
 * This is the dialog's answer to "how do I get a kanban": add a Select or
 * Status and watch Board light up before saving anything.
 */
export function TagViewsStrip({ properties }: TagViewsStripProps): ReactElement {
  const groupable = boardGroupablePropertiesOf(properties)
  const dateProperty = calendarPropertyOf(properties)
  const pills: ViewPill[] = [
    {
      label: 'Table',
      Glyph: Layers,
      poweredBy: null,
      on: properties.length > 0,
      hint: 'add a property',
    },
    {
      label: 'Board',
      Glyph: LayoutTemplate,
      poweredBy: groupable[0]?.name.trim() || null,
      on: groupable.length > 0,
      hint: 'add a Select or Status',
    },
    {
      label: 'Calendar',
      Glyph: Calendar,
      poweredBy: dateProperty?.name.trim() || null,
      on: dateProperty !== null,
      hint: 'add a Date',
    },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Views this schema unlocks">
      <span className={FIELD_LABEL_CLASS}>Views</span>
      {pills.map(({ label, Glyph, poweredBy, on, hint }) => (
        <span
          key={label}
          className={
            on
              ? 'flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-soft-text'
              : 'flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-muted'
          }
        >
          <Glyph aria-hidden className="size-3" />
          {on ? (poweredBy === null ? label : `${label} · ${poweredBy}`) : `${label} — ${hint}`}
        </span>
      ))}
    </div>
  )
}
