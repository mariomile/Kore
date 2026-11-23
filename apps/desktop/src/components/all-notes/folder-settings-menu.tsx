import type { ReactElement } from 'react'
import { Settings } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'

interface FolderSettingsMenuProps {
  includeSubfolders: boolean
  onIncludeSubfoldersChange: (include: boolean) => void
}

/**
 * A folder page's own settings, behind the header gear like a tag page's:
 * whether the notes inside its subfolders join the list.
 */
export function FolderSettingsMenu({
  includeSubfolders,
  onIncludeSubfoldersChange,
}: FolderSettingsMenuProps): ReactElement {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Folder settings"
        title="Folder settings"
        className="app-icon-button text-text-muted hover:text-text"
      >
        <Settings aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-1">
        <p className="px-2 pt-1 pb-0.5 text-2xs font-medium text-text-muted">Folder settings</p>
        <label className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-hover">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-text">Include subfolders</span>
            <span className="text-xs text-text-muted">Also list the notes inside them</span>
          </span>
          <Switch
            size="sm"
            checked={includeSubfolders}
            onCheckedChange={onIncludeSubfoldersChange}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}
