import { useMemo, useState, type ReactElement } from 'react'
import { Folder, FolderPlus } from '@/components/icons'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { flattenFolders, matchFolders } from '@/lib/folders/folder-options'
import {
  closeMoveToFolder,
  openMoveToFolder,
  useMoveToFolderTarget,
} from '@/lib/folders/move-to-folder-store'
import { folderOf, useNoteBulkActions } from '@/lib/notes/use-note-bulk-actions'

// PROTOTYPE hook for screenshots: window.__koreMoveToFolder('CRM/People/Ada.md')
;(window as unknown as Record<string, unknown>).__koreMoveToFolder = openMoveToFolder

/**
 * Move to folder (⌘⇧M): one searchable list of the vault's folders, the
 * note's current folder checked, and "New folder" when the typed path
 * doesn't exist yet. The move carries the open editor and rewrites links.
 */
export function MoveToFolderDialog(): ReactElement | null {
  const path = useMoveToFolderTarget()
  const tree = useFolderTree()
  const { move } = useNoteBulkActions()
  const [query, setQuery] = useState('')
  const options = useMemo(() => (tree === null ? [] : flattenFolders(tree)), [tree])
  if (path === null) {
    return null
  }
  const current = folderOf(path)
  const matches = matchFolders(options, query).slice(0, 60)
  const typed = query.trim().replace(/^\/+|\/+$/g, '')
  const exists = options.some((option) => option.path.toLowerCase() === typed.toLowerCase())
  const close = (): void => {
    setQuery('')
    closeMoveToFolder()
  }
  const finish = (folder: string): void => {
    close()
    if (folder !== current) {
      void move([path], folder)
    }
  }
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
      title="Move to folder"
      description="Choose the folder this note moves to"
    >
      <Command label="Move to folder" shouldFilter={false}>
        <CommandInput placeholder="Move to folder…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No folders</CommandEmpty>
          {typed !== '' && !exists ? (
            <CommandGroup>
              <CommandItem value={`new:${typed}`} onSelect={() => finish(typed)}>
                <FolderPlus aria-hidden className="text-accent" />
                <span className="truncate">
                  New folder <span className="font-medium">{typed}</span>
                </span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          <CommandGroup>
            {query === '' ? (
              <CommandItem
                value="root"
                data-checked={current === ''}
                onSelect={() => finish('')}
              >
                <Folder aria-hidden className="text-text-muted" />
                <span className="truncate">Vault root</span>
              </CommandItem>
            ) : null}
            {matches.map((option) => (
              <CommandItem
                key={option.path}
                value={option.path}
                data-checked={option.path === current}
                onSelect={() => finish(option.path)}
              >
                <Folder aria-hidden className="text-text-muted" />
                <span className="shrink-0">{option.name}</span>
                {option.parent !== '' ? (
                  <span className="min-w-0 truncate text-xs text-text-muted">{option.parent}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
