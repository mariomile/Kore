import type { ReactElement } from 'react'
import { Globe, NoteEdit, Plus, Terminal } from '@/components/icons'
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
 * The tab-strip "+" : New note (⌘N), the built-in browser or the terminal.
 * Both open as workspace tabs (their routes) rather than separate windows;
 * the terminal lives here instead of a sidebar row. The palette is still ⌘K.
 */
export function NoteTabsPlusMenu({ context }: NoteTabsPlusMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="New tab"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-surface-hover hover:text-text-secondary active:scale-[0.97]"
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
        <DropdownMenuItem
          onClick={() => {
            void runCommand('nav.terminal', context)
          }}
        >
          <Terminal aria-hidden className="size-3.5" />
          Terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
