import { useMemo, useState, type ReactElement } from 'react'
import { Check, Folder, FolderPlus } from '@/components/icons'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { flattenFolders, matchFolders } from '@/lib/folders/folder-options'
import { folderOf, useNoteBulkActions } from '@/lib/notes/use-note-bulk-actions'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { SearchInput } from '@/mobile/search-input'

interface MoveToFolderDrawerProps {
  /** The note to move. */
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The note ⋯ sheet's Move to…: the Mac picker's list as an iOS sheet. A
 * search field, then every folder (name over its parent path), the note's
 * current one checked; typing a path that doesn't exist offers New folder.
 */
export function MoveToFolderDrawer({ path, open, onOpenChange }: MoveToFolderDrawerProps): ReactElement {
  const tree = useFolderTree()
  const { move } = useNoteBulkActions()
  const [query, setQuery] = useState('')
  const options = useMemo(() => (tree === null ? [] : flattenFolders(tree)), [tree])
  const current = folderOf(path)
  const matches = matchFolders(options, query)
  const typed = query.trim().replace(/^\/+|\/+$/g, '')
  const exists = options.some((option) => option.path.toLowerCase() === typed.toLowerCase())

  const finish = (folder: string): void => {
    hapticImpactLight()
    onOpenChange(false)
    setQuery('')
    if (folder !== current) {
      void move([path], folder)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[85dvh]">
        <DrawerTitle className="text-center text-[17px] font-semibold">Move to</DrawerTitle>
        <DrawerBody className="px-4">
          <SearchInput
            placeholder="Find or create a folder…"
            aria-label="Find a folder"
            value={query}
            onValueChange={setQuery}
          />
          <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
            {typed !== '' && !exists ? (
              <FolderRow
                icon={<FolderPlus className="size-[18px] text-accent" />}
                name={`New folder “${typed}”`}
                onPress={() => finish(typed)}
              />
            ) : null}
            {query === '' ? (
              <FolderRow
                icon={<Folder className="size-[18px]" />}
                name="Vault root"
                checked={current === ''}
                onPress={() => finish('')}
              />
            ) : null}
            {matches.map((option) => (
              <FolderRow
                key={option.path}
                icon={<Folder className="size-[18px]" />}
                name={option.name}
                detail={option.parent}
                checked={option.path === current}
                onPress={() => finish(option.path)}
              />
            ))}
          </ul>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

function FolderRow({
  icon,
  name,
  detail,
  checked = false,
  onPress,
}: {
  icon: ReactElement
  name: string
  detail?: string
  checked?: boolean
  onPress: () => void
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-pressed={checked}
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
        {checked ? <Check aria-label="Current folder" className="size-4 shrink-0 text-accent" /> : null}
      </button>
    </li>
  )
}
