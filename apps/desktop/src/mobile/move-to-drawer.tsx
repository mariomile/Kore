import type { ReactElement } from 'react'
import { folderDisplayName } from '@kore/core'
import { FolderPlus } from '@/components/icons'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import type { MoveTarget } from '@/lib/folders/use-folder-operations'
import { useFolderPicker } from '@/lib/folders/use-folder-picker'
import { FolderRow } from '@/mobile/folder-row'
import { haptic } from '@/lib/haptics'
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
    haptic('success')
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
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
            {picker.query === '' && picker.suggestions.length > 0 ? (
              <>
                <SectionLabel>Suggested</SectionLabel>
                <ul aria-label="Suggested folders" className="pb-2">
                  {picker.suggestions.map((option) => (
                    <FolderRow
                      key={option.path}
                      name={option.name}
                      detail={option.parent}
                      onPress={() => finish(option.path)}
                    />
                  ))}
                </ul>
                <SectionLabel>All folders</SectionLabel>
              </>
            ) : null}
            <ul aria-label="Folders">
              {picker.query === '' ? (
                <FolderRow
                  name="Vault root"
                  checked={picker.current === ''}
                  onPress={() => finish('')}
                />
              ) : null}
              {picker.matches.map((option) => (
                <FolderRow
                  key={option.path}
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
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

function SectionLabel({ children }: { children: string }): ReactElement {
  return <h3 className="px-2 pt-2 pb-1 text-[13px] font-medium text-text-muted">{children}</h3>
}
