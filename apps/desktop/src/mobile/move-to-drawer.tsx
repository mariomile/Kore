import type { ReactElement } from 'react'
import { folderDisplayName } from '@kore/core'
import { Check, Folder, FolderPlus } from '@/components/icons'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import type { MoveTarget } from '@/lib/folders/use-folder-operations'
import { useFolderPicker } from '@/lib/folders/use-folder-picker'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { SearchInput } from '@/mobile/search-input'

interface MoveToDrawerProps {
  /** The note or folder to move; null keeps the sheet closed. */
  target: MoveTarget | null
  onClose: () => void
}

/**
 * The iPhone's Move to…, the Mac picker as a sheet: a search field, then
 * every folder (its name over its parent's path), the current one checked.
 * Typing a path no folder has offers New folder. Opens from a note's ⋯ and
 * from a folder page's ⋯.
 */
export function MoveToDrawer({ target, onClose }: MoveToDrawerProps): ReactElement {
  const picker = useFolderPicker(target)
  const finish = (destination: string): void => {
    hapticImpactLight()
    onClose()
    picker.choose(destination)
  }
  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          picker.setQuery('')
          onClose()
        }
      }}
    >
      <DrawerContent className="h-[85dvh]">
        <DrawerTitle className="truncate px-12 text-center text-[17px] font-semibold">
          {target?.kind === 'folder' ? `Move “${folderDisplayName(target.path)}”` : 'Move to'}
        </DrawerTitle>
        <DrawerBody className="flex min-h-0 flex-1 flex-col px-4">
          <SearchInput
            placeholder="Find or create a folder…"
            aria-label="Find a folder"
            value={picker.query}
            onValueChange={picker.setQuery}
          />
          <ul aria-label="Folders" className="-mx-2 min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
            {picker.query === '' ? (
              <FolderRow
                icon={<Folder className="size-[18px]" />}
                name="Vault root"
                checked={picker.current === ''}
                onPress={() => finish('')}
              />
            ) : null}
            {picker.matches.map((option) => (
              <FolderRow
                key={option.path}
                icon={<Folder className="size-[18px]" />}
                name={option.name}
                detail={option.parent}
                checked={option.path === picker.current}
                onPress={() => finish(option.path)}
              />
            ))}
            {picker.newFolder !== null ? (
              <FolderRow
                icon={<FolderPlus className="size-[18px] text-accent" />}
                name={`New folder “${picker.newFolder}”`}
                onPress={() => finish(picker.newFolder!)}
              />
            ) : null}
            {picker.newFolder === null && picker.matches.length === 0 && picker.query !== '' ? (
              <li className="px-2 py-6 text-center text-sm text-text-muted">
                {picker.problem ?? 'No folders'}
              </li>
            ) : null}
          </ul>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

interface FolderRowProps {
  icon: ReactElement
  name: string
  /** The parent folder's path under the name; hidden at the root. */
  detail?: string
  checked?: boolean
  onPress: () => void
}

function FolderRow({ icon, name, detail, checked = false, onPress }: FolderRowProps): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-current={checked ? 'true' : undefined}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-surface-hover',
          checked && 'bg-surface-hover',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base">{name}</span>
          {detail !== undefined && detail !== '' ? (
            <span className="truncate text-[13px] text-text-muted">{detail}</span>
          ) : null}
        </span>
        {checked ? (
          <Check aria-label="Current folder" className="size-4 shrink-0 text-accent" />
        ) : null}
      </button>
    </li>
  )
}
