import type { ReactElement } from 'react'
import { folderDisplayName } from '@kore/core'
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
import { closeMoveTo, useMoveToTarget } from '@/lib/folders/move-to-store'
import { useFolderPicker } from '@/lib/folders/use-folder-picker'
import type { MoveTarget } from '@/lib/folders/use-folder-operations'

/**
 * The Mac's Move to…: one searchable list of the vault's folders for a note
 * (its context menu, the palette) or a folder (the sidebar's folder menu).
 * The current folder is checked; typing a path no folder has offers to
 * create it. The move carries open editors and rewrites path links.
 */
export function MoveToDialog(): ReactElement | null {
  const target = useMoveToTarget()
  return target === null ? null : (
    <MoveToPicker key={`${target.kind}:${target.path}`} target={target} />
  )
}

function MoveToPicker({ target }: { target: MoveTarget }): ReactElement {
  const picker = useFolderPicker(target)
  const close = (): void => {
    picker.setQuery('')
    closeMoveTo()
  }
  const finish = (destination: string): void => {
    closeMoveTo()
    picker.choose(destination)
  }
  const subject = target.kind === 'folder' ? `“${folderDisplayName(target.path)}”` : 'note'
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
      title={`Move ${subject} to`}
      description="Choose the folder to move to, or type a new one"
    >
      <Command label="Move to folder" shouldFilter={false}>
        <CommandInput
          placeholder={`Move ${subject} to…`}
          value={picker.query}
          onValueChange={picker.setQuery}
        />
        <CommandList>
          <CommandEmpty>{picker.problem ?? 'No folders'}</CommandEmpty>
          <CommandGroup>
            {picker.query === '' ? (
              <CommandItem
                value="root"
                data-checked={picker.current === ''}
                onSelect={() => finish('')}
              >
                <Folder aria-hidden className="text-text-muted" />
                <span className="truncate">Vault root</span>
              </CommandItem>
            ) : null}
            {picker.matches.map((option) => (
              <CommandItem
                key={option.path}
                value={option.path}
                data-checked={option.path === picker.current}
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
          {picker.newFolder !== null ? (
            <CommandGroup>
              <CommandItem
                value={`new:${picker.newFolder}`}
                onSelect={() => finish(picker.newFolder!)}
              >
                <FolderPlus aria-hidden className="text-accent" />
                <span className="truncate">
                  New folder <span className="font-medium">{picker.newFolder}</span>
                </span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
