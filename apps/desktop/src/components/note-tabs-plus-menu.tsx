import type { ReactElement } from 'react'
import { Globe, NoteEdit, Plus } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { runCommand } from '@/lib/commands/registry'
import type { CommandContext } from '@/lib/commands/types'

interface NoteTabsPlusMenuProps {
  context: CommandContext
}

/**
 * The tab-strip "+" : New note (⌘N) or the in-app browser tab. The palette
 * is still ⌘K; this control used to open it, which left no way to choose
 * the browser the strip already knows how to host.
 */
export function NoteTabsPlusMenu({ context }: NoteTabsPlusMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="New note or browser"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-surface-hover hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-44">
        <DropdownMenuItem
          onClick={() => {
            void runCommand('note.new', context)
          }}
        >
          <NoteEdit aria-hidden className="size-3.5" />
          New note
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void runCommand('browser.open', context)
          }}
        >
          <Globe aria-hidden className="size-3.5" />
          Browser
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
