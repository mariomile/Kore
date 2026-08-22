import type { ReactElement } from 'react'
import { SearchIcon } from '@/components/icons/search-icon'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { keybindingFor } from '@/lib/commands/app-commands'

const PALETTE_BINDING = keybindingFor('palette.open')

/**
 * The sidebar's search affordance: a lens icon that opens the one ⌘K
 * surface. The shortcut lives in the tooltip so the title-bar band stays
 * just the lens and the microphone.
 */
export function SidebarSearch({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search"
            onClick={onOpen}
            className="text-text-muted hover:text-text-secondary dark:hover:text-text"
          >
            <SearchIcon className="size-5" />
          </Button>
        }
      />
      <TooltipContent side="bottom">
        Search {PALETTE_BINDING !== null ? <ShortcutKeys binding={PALETTE_BINDING} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}
