import type { ReactElement } from 'react'
import { ALL_NOTES_SORTS, type AllNotesSort, type AllNotesView } from '@reflect/core'
import { LayoutGrid, List } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettings } from '@/providers/settings-provider'

interface AllNotesViewControlsProps {
  view: AllNotesView
  onViewChange: (mode: AllNotesView) => void
}

const SORT_LABELS: Record<AllNotesSort, string> = {
  'updated-desc': 'Last updated',
  'updated-asc': 'Oldest updated',
  'title-asc': 'Title A to Z',
  'title-desc': 'Title Z to A',
}

/**
 * The plain note list's sort and list/grid toggle — shared by All notes and
 * folder pages, so both read and write the same persisted sort.
 */
export function AllNotesViewControls({
  view,
  onViewChange,
}: AllNotesViewControlsProps): ReactElement {
  const { settings, updateSettings } = useSettings()
  return (
    <>
      <Select
        value={settings.allNotesSort}
        items={SORT_LABELS}
        onValueChange={(value) => {
          if (typeof value === 'string' && (ALL_NOTES_SORTS as readonly string[]).includes(value)) {
            updateSettings({ allNotesSort: value as AllNotesSort })
          }
        }}
      >
        <SelectTrigger aria-label="Sort" data-size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALL_NOTES_SORTS.map((sort) => (
            <SelectItem key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div
        role="group"
        aria-label="Layout"
        className="flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
      >
        {(
          [
            { mode: 'list', label: 'List view', Glyph: List },
            { mode: 'grid', label: 'Grid view', Glyph: LayoutGrid },
          ] as const
        ).map(({ mode, label, Glyph }) => (
          <button
            key={mode}
            type="button"
            aria-label={label}
            aria-pressed={view === mode}
            onClick={() => {
              onViewChange(mode)
            }}
            className={`flex size-6 items-center justify-center rounded-full transition-colors ${
              view === mode
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Glyph aria-hidden className="size-3.5" />
          </button>
        ))}
      </div>
    </>
  )
}
