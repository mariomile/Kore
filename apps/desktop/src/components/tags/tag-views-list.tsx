import type { ReactElement } from 'react'
import type { TagProperty } from '@kore/core'
import { Calendar, CheckCircle, Layers, LayoutTemplate, type Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { boardGroupablePropertiesOf, calendarPropertyOf } from '@/lib/tags/schema-views'
import { TagSettingRow } from './tag-setting-row'

interface TagViewsListProps {
  /** The live draft schema (partial rows included — availability is type-based). */
  properties: readonly TagProperty[]
  /** Add the property a view is missing. */
  onAdd: (starter: TagProperty) => void
  touch?: boolean
}

interface ViewRow {
  label: string
  Glyph: Icon
  /** What the view does with the schema, shown once it is available. */
  ready: string | null
  /** What the schema still needs, shown while the view is off. */
  needs: string
  /** The button that adds what is missing; Table has none, any property turns it on. */
  add: { label: string; starter: TagProperty } | null
}

const STATUS_STARTER: TagProperty = {
  name: 'Status',
  key: 'status',
  type: 'status',
  options: ['To do', 'In progress', 'Done'],
}
const DATE_STARTER: TagProperty = { name: 'Date', key: 'date', type: 'date' }

/**
 * The starter under a name no property of the schema holds yet ("Status 2"
 * beside a text property called Status), so adding it never leaves the draft
 * with two properties on one key.
 */
function freeStarter(starter: TagProperty, properties: readonly TagProperty[]): TagProperty {
  const taken = new Set(properties.flatMap(({ key, name }) => [key, name.trim().toLowerCase()]))
  if (!taken.has(starter.key) && !taken.has(starter.name.toLowerCase())) {
    return starter
  }
  let n = 2
  while (taken.has(`${starter.key}-${n}`) || taken.has(`${starter.name.toLowerCase()} ${n}`)) {
    n += 1
  }
  return { ...starter, name: `${starter.name} ${n}`, key: `${starter.key}-${n}` }
}

/**
 * The collection views this tag's properties unlock, and — while one is still
 * off — the one button that turns it on. Availability comes from the same
 * predicates the board and calendar use (`schema-views.ts`), so the list can
 * never drift from the truth. This is the settings' answer to "how do I get a
 * kanban": press Add status and Board is ready before anything is saved.
 */
export function TagViewsList({
  properties,
  onAdd,
  touch = false,
}: TagViewsListProps): ReactElement {
  const groupBy = boardGroupablePropertiesOf(properties)[0]?.name.trim()
  const placeBy = calendarPropertyOf(properties)?.name.trim()
  const rows: ViewRow[] = [
    {
      label: 'Table',
      Glyph: Layers,
      ready: properties.length > 0 ? 'A column for each property' : null,
      needs: 'Needs a property',
      add: null,
    },
    {
      label: 'Board',
      Glyph: LayoutTemplate,
      ready: groupBy === undefined ? null : `Grouped by ${groupBy || 'a property'}`,
      needs: 'Needs a Select or Status',
      add: { label: 'Add status', starter: STATUS_STARTER },
    },
    {
      label: 'Calendar',
      Glyph: Calendar,
      ready: placeBy === undefined ? null : `Placed by ${placeBy || 'a date'}`,
      needs: 'Needs a Date',
      add: { label: 'Add date', starter: DATE_STARTER },
    },
  ]
  return (
    <>
      {rows.map(({ label, Glyph, ready, needs, add }) => (
        <TagSettingRow
          key={label}
          icon={Glyph}
          title={label}
          description={ready ?? needs}
          touch={touch}
        >
          {ready !== null ? (
            <span className="flex items-center gap-1 text-xs font-medium text-accent-soft-text">
              <CheckCircle aria-hidden className="size-4" />
              Ready
            </span>
          ) : add === null ? null : (
            <Button
              type="button"
              variant="outline"
              size={touch ? 'default' : 'sm'}
              onClick={() => onAdd(freeStarter(add.starter, properties))}
            >
              {add.label}
            </Button>
          )}
        </TagSettingRow>
      ))}
    </>
  )
}
