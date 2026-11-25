import type { ReactElement } from 'react'
import { FILE_KIND_FILTERS, type FileKindFilter } from '@kore/core'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { HEADER_SELECT_TRIGGER_CLASS } from './all-notes-view-controls'

/** The Select's value for "no filter": Base UI keys its items by string. */
const EVERYTHING = 'everything'

const LABELS: Record<string, string> = {
  [EVERYTHING]: 'File type',
  ...Object.fromEntries(FILE_KIND_FILTERS.map(({ kind, label }) => [kind, label])),
}

interface FileKindMenuProps {
  value: FileKindFilter | null
  onChange: (kind: FileKindFilter | null) => void
}

/**
 * The header's File type pill, beside Sort: notes only, or one kind of the
 * vault's loose files (the cards a folder page shows). The iPhone's File type
 * badge, as a Mac header menu.
 */
export function FileKindMenu({ value, onChange }: FileKindMenuProps): ReactElement {
  return (
    <Select
      value={value ?? EVERYTHING}
      items={LABELS}
      onValueChange={(next) => {
        const picked = FILE_KIND_FILTERS.find((entry) => entry.kind === next)
        onChange(picked?.kind ?? null)
      }}
    >
      <SelectTrigger
        aria-label="File type"
        size="sm"
        className={cn(HEADER_SELECT_TRIGGER_CLASS, value !== null && 'text-text')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="end"
        sideOffset={6}
        className="w-auto min-w-44 p-1"
      >
        <SelectItem value={EVERYTHING} className="text-[13px]">
          Everything
        </SelectItem>
        {FILE_KIND_FILTERS.map(({ kind, label }) => (
          <SelectItem key={kind} value={kind} className="text-[13px]">
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
