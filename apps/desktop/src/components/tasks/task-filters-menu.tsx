import type { ReactElement } from 'react'
import type { TaskTagCount } from '@kore/core'
import { Filter } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TaskFilters, TaskFiltersControl } from '@/lib/tasks/task-filters'

const BUCKET_FILTERS: ReadonlyArray<{ key: keyof TaskFilters; label: string }> = [
  { key: 'pinned', label: 'Pinned tasks' },
  { key: 'current', label: 'Current tasks' },
  { key: 'overdue', label: 'Overdue tasks' },
  { key: 'upcoming', label: 'Upcoming tasks' },
  { key: 'other', label: 'Other tasks' },
]

interface TaskFiltersMenuProps extends TaskFiltersControl {
  /** Controlled open state, so ⌘⇧E can toggle the menu (V1). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Show the per-bucket toggles — they only apply to the All view. */
  bucketFilters?: boolean
  /** The tags the open tasks use; each toggles a `#tag` filter in the search. */
  tags?: readonly TaskTagCount[]
  /** The folded tags the search filters by now. */
  activeTags?: readonly string[]
  onToggleTag?: (tag: string) => void
}

/** How many tags the menu lists; the search box takes any other `#tag`. */
const MENU_TAGS = 12

/**
 * The Tasks view's "Task filters" dropdown (V1): per-bucket toggles,
 * "Show archived tasks", and the open tasks' tags (Todoist's labels), which
 * write `#tag` into the search so the filter stays visible and editable. Toggling keeps the menu open (`preventDefault` on
 * select) so several filters can be flipped at once. Open state is controlled so
 * the ⌘⇧E shortcut can open and close it.
 */
export function TaskFiltersMenu({
  filters,
  toggle,
  open,
  onOpenChange,
  bucketFilters = true,
  tags = [],
  activeTags = [],
  onToggleTag,
}: TaskFiltersMenuProps): ReactElement {
  // The active tags always show, so one can be turned off even when rarely used.
  const listed = tags.filter((entry, index) => index < MENU_TAGS || activeTags.includes(entry.key))
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="window-drag-control pr-2 text-xs font-normal text-text-muted"
          >
            <Filter aria-hidden className="size-3.5" />
            Task filters
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {bucketFilters ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Tasks</DropdownMenuLabel>
              {BUCKET_FILTERS.map(({ key, label }) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={filters[key]}
                  onCheckedChange={() => toggle(key)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={filters.archived}
          onCheckedChange={() => toggle('archived')}
        >
          Show archived tasks
        </DropdownMenuCheckboxItem>
        {onToggleTag !== undefined && listed.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Tags</DropdownMenuLabel>
              {listed.map((entry) => (
                <DropdownMenuCheckboxItem
                  key={entry.key}
                  checked={activeTags.includes(entry.key)}
                  onCheckedChange={() => onToggleTag(entry.tag)}
                >
                  <span className="min-w-0 flex-1 truncate">#{entry.tag}</span>
                  <span className="text-xs text-text-muted tabular-nums">{entry.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
