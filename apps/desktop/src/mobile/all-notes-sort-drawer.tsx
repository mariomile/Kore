import type { ReactElement } from 'react'
import {
  ALL_NOTES_SORT_DEFAULT_DIRECTION,
  allNotesSortFrom,
  allNotesSortParts,
  type AllNotesSort,
  type AllNotesSortDirection,
  type AllNotesSortField,
} from '@kore/core'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { hapticImpactLight } from '@/mobile/haptics'
import { SettingsGroup, SettingsSegmentedRow, SettingsSelectRow } from '@/mobile/settings-list'

const FIELDS: readonly { field: AllNotesSortField; label: string }[] = [
  { field: 'updated', label: 'Last updated' },
  { field: 'title', label: 'Title' },
]

/** Each field's direction pair, in reading order (its natural direction first). */
const DIRECTIONS: Record<
  AllNotesSortField,
  readonly { value: AllNotesSortDirection; label: string }[]
> = {
  updated: [
    { value: 'desc', label: 'Newest first' },
    { value: 'asc', label: 'Oldest first' },
  ],
  title: [
    { value: 'asc', label: 'A to Z' },
    { value: 'desc', label: 'Z to A' },
  ],
}

/** The sort's one-line spoken summary, for the trigger's accessible name. */
export function allNotesSortSummary(sort: AllNotesSort): string {
  const { field, direction } = allNotesSortParts(sort)
  const fieldLabel = FIELDS.find((entry) => entry.field === field)!.label
  const directionLabel = DIRECTIONS[field].find((entry) => entry.value === direction)!.label
  return `${fieldLabel}, ${directionLabel}`
}

interface AllNotesSortDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sort: AllNotesSort
  onSortChange: (sort: AllNotesSort) => void
}

/**
 * The Notes tab's sort sheet — the same persisted `allNotesSort` as the Mac
 * list's Sort menu, split into the field (a checked list) and its direction
 * (a segmented row), the iOS Settings way the type page's view options use.
 * Choices apply live and the sheet stays open, so a field and its direction
 * are one visit; it dismisses by drag or tapping outside.
 */
export function AllNotesSortDrawer({
  open,
  onOpenChange,
  sort,
  onSortChange,
}: AllNotesSortDrawerProps): ReactElement {
  const { field, direction } = allNotesSortParts(sort)
  const pickField = (next: AllNotesSortField): void => {
    if (next === field) {
      return
    }
    hapticImpactLight()
    onSortChange(allNotesSortFrom(next, ALL_NOTES_SORT_DEFAULT_DIRECTION[next]))
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label="Sort notes">
        <div className="flex h-14 shrink-0 items-end justify-center px-12 pb-1">
          <DrawerTitle className="truncate px-0 pt-0 pb-2.5 text-center text-[17px] font-semibold">
            Sort
          </DrawerTitle>
        </div>
        <div className="flex flex-col gap-6 px-4 pt-4 pb-8">
          <SettingsGroup header="Sort by">
            {FIELDS.map((entry) => (
              <SettingsSelectRow
                key={entry.field}
                label={entry.label}
                selected={entry.field === field}
                onPress={() => pickField(entry.field)}
              />
            ))}
          </SettingsGroup>
          <SettingsGroup footer="Pinned notes always stay on top.">
            <SettingsSegmentedRow
              label="Order"
              value={direction}
              options={DIRECTIONS[field]}
              onChange={(next) => {
                hapticImpactLight()
                onSortChange(allNotesSortFrom(field, next))
              }}
            />
          </SettingsGroup>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
