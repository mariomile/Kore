import type { ReactElement, ReactNode } from 'react'
import { isProtectedFolder } from '@kore/core'
import { FolderMove, FolderPlus, Layers, NoteEdit, Pencil, Trash } from '@/components/icons'
import type { FolderDialogState } from '@/components/folders/folder-dialogs'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface FolderActionsDrawerProps {
  /** The page's folder; `''` is the vault's top level. */
  folder: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open one of the shared folder dialogs. */
  onDialog: (dialog: FolderDialogState) => void
  /** Open the Move to… sheet for this folder. */
  onMove: () => void
  includeSubfolders: boolean
  onIncludeSubfoldersChange: (include: boolean) => void
}

/**
 * A folder page's ⋯ sheet on iPhone: the Mac folder menu's actions (new
 * note here, new subfolder, rename, move, trash) and the folder's one
 * setting, whether its subfolders' notes join the list. The top level only
 * creates; Kore's own folders (daily, templates…) can't be renamed, moved
 * or trashed, as on the Mac.
 */
export function FolderActionsDrawer({
  folder,
  open,
  onOpenChange,
  onDialog,
  onMove,
  includeSubfolders,
  onIncludeSubfoldersChange,
}: FolderActionsDrawerProps): ReactElement {
  const atTop = folder === ''
  const fixed = atTop || isProtectedFolder(folder)
  const run = (action: () => void): void => {
    onOpenChange(false)
    action()
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerTitle className="sr-only">Folder actions</DrawerTitle>
        <div className="flex flex-col gap-1 p-4">
          <ActionButton
            icon={<NoteEdit />}
            label={atTop ? 'New note' : 'New note here'}
            onPress={() => run(() => onDialog({ kind: 'newNote', folderPath: folder }))}
          />
          <ActionButton
            icon={<FolderPlus />}
            label={atTop ? 'New folder' : 'New subfolder'}
            onPress={() => run(() => onDialog({ kind: 'newSubfolder', folderPath: folder }))}
          />
          {fixed ? null : (
            <>
              <ActionButton
                icon={<Pencil />}
                label="Rename"
                onPress={() => run(() => onDialog({ kind: 'rename', folderPath: folder }))}
              />
              <ActionButton icon={<FolderMove />} label="Move to…" onPress={() => run(onMove)} />
            </>
          )}
          {atTop ? null : (
            <label className="flex min-h-14 items-center gap-3 rounded-lg px-2.5">
              <Layers aria-hidden className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base text-text">Include subfolders</span>
                <span className="text-[13px] text-text-muted">Also list the notes inside them</span>
              </span>
              <Switch checked={includeSubfolders} onCheckedChange={onIncludeSubfoldersChange} />
            </label>
          )}
          {fixed ? null : (
            <ActionButton
              icon={<Trash />}
              label="Move to Trash"
              destructive
              onPress={() => run(() => onDialog({ kind: 'trash', folderPath: folder }))}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

interface ActionButtonProps {
  icon: ReactNode
  label: string
  destructive?: boolean
  onPress: () => void
}

function ActionButton({
  icon,
  label,
  destructive = false,
  onPress,
}: ActionButtonProps): ReactElement {
  return (
    <Button
      variant="ghost"
      size="lg"
      className={cn(
        'h-12 justify-start gap-3 text-base',
        destructive && 'text-destructive hover:text-destructive',
      )}
      onClick={onPress}
    >
      {icon}
      {label}
    </Button>
  )
}
