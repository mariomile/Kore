import type { ReactElement } from 'react'
import type { TagProperty } from '@kore/core'
import { Layers } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface CollectionGroupMenuProps {
  properties: readonly TagProperty[]
  /** Currently grouped property key, or `null` when flat. */
  value: string | null
  /** Whether flat ("No grouping") is an option (Table / Timeline: yes; Board: no). */
  allowNone: boolean
  ariaLabel?: string
  onChange: (key: string | null) => void
}

/**
 * Minimal collection grouping trigger: a quiet icon button when flat (matching
 * Filter, Columns, Settings, and Options in the toolbar), expanding into a
 * subtle pill showing the active group field only when grouping is engaged.
 */
export function CollectionGroupMenu({
  properties,
  value,
  allowNone,
  ariaLabel = 'Group by',
  onChange,
}: CollectionGroupMenuProps): ReactElement {
  const activeProperty = properties.find((property) => property.key === value) ?? null
  const selectValue = activeProperty?.key ?? (allowNone ? '__none' : '')
  const items = Object.fromEntries([
    ...(allowNone ? [['__none', 'No grouping']] : []),
    ...properties.map((property) => [property.key, property.name]),
  ])
  const showPill = activeProperty !== null

  return (
    <Select
      value={selectValue}
      items={items}
      onValueChange={(next) => {
        if (typeof next === 'string' && next !== '') {
          onChange(next === '__none' ? null : next)
        }
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        title={activeProperty === null ? 'Group by' : `Grouped by ${activeProperty.name}`}
        hideIndicator
        size="sm"
        className={cn(
          'border-0 shadow-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          showPill
            ? allowNone
              ? 'h-7 gap-1.5 rounded-full bg-accent-soft px-2.5 text-xs font-medium text-accent-soft-text hover:opacity-90 dark:bg-accent-soft dark:hover:bg-accent-soft'
              : 'h-7 gap-1.5 rounded-full bg-surface-hover px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-active hover:text-text dark:bg-surface-hover dark:hover:bg-surface-active'
            : 'size-7 justify-center rounded-md bg-transparent p-0 text-text-muted hover:bg-surface-hover hover:text-text dark:bg-transparent dark:hover:bg-surface-hover',
        )}
      >
        <Layers aria-hidden className="size-3.5 shrink-0" />
        {showPill ? <span className="max-w-28 truncate">{activeProperty.name}</span> : null}
      </SelectTrigger>
      <SelectContent align="end" sideOffset={6} className="min-w-44">
        <SelectGroup>
          <SelectLabel>Group by</SelectLabel>
          {allowNone ? <SelectItem value="__none">No grouping</SelectItem> : null}
          {properties.map((property) => (
            <SelectItem key={property.key} value={property.key}>
              {property.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
