import type { ReactElement } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface FolderPageControlsProps {
  titleQuery: string
  onTitleQueryChange: (query: string) => void
  includeSubfolders: boolean
  onIncludeSubfoldersChange: (include: boolean) => void
}

/**
 * A folder page's own lens, beside the shared sort and layout: a title
 * filter over the listed notes and whether notes in subfolders join them.
 */
export function FolderPageControls({
  titleQuery,
  onTitleQueryChange,
  includeSubfolders,
  onIncludeSubfoldersChange,
}: FolderPageControlsProps): ReactElement {
  return (
    <>
      <Input
        type="search"
        aria-label="Filter notes"
        placeholder="Filter"
        value={titleQuery}
        onChange={(event) => onTitleQueryChange(event.target.value)}
        className="h-7 w-40 text-sm"
      />
      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Switch size="sm" checked={includeSubfolders} onCheckedChange={onIncludeSubfoldersChange} />
        Include subfolders
      </label>
    </>
  )
}
