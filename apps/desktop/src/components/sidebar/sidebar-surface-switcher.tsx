import type { ReactElement } from 'react'
import { Calendar, Chat, Home } from '@/components/icons'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { keybindingFor } from '@/lib/commands/app-commands'
import { cn } from '@/lib/utils'
import type { SidebarSurface } from './sidebar-surface'

interface SidebarSurfaceSwitcherProps {
  /** The rail currently shown below the bar. */
  surface: SidebarSurface
  /** Select a surface (the caller owns any navigation side effects). */
  onSelect: (surface: SidebarSurface) => void
}

const CHAT_BINDING = keybindingFor('chat.open')

/**
 * The Notion-style surface bar: a labeled Home pill followed by icon-only
 * Chat and Meetings toggles, sitting inline with the search and audio-memo
 * icons at the top of the sidebar. Picking one swaps the rail below; the
 * selected surface carries the active wash so the bar always shows where
 * the rail is.
 */
export function SidebarSurfaceSwitcher({
  surface,
  onSelect,
}: SidebarSurfaceSwitcherProps): ReactElement {
  return (
    <nav aria-label="Sidebar surfaces" className="flex items-center gap-0.5">
      <button
        type="button"
        aria-current={surface === 'home' ? 'page' : undefined}
        onClick={() => onSelect('home')}
        className={cn(
          'flex h-7 flex-none items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors duration-100',
          surface === 'home'
            ? 'bg-surface-active text-text'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
      >
        <Home aria-hidden className="size-4" />
        Home
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Chat"
              aria-current={surface === 'chat' ? 'page' : undefined}
              onClick={() => onSelect('chat')}
              className={cn(
                surface === 'chat'
                  ? 'bg-surface-active text-text'
                  : 'text-text-muted hover:text-text-secondary dark:hover:text-text',
              )}
            >
              <Chat aria-hidden className="size-4" />
            </Button>
          }
        />
        <TooltipContent side="bottom">
          Chat {CHAT_BINDING !== null ? <ShortcutKeys binding={CHAT_BINDING} /> : null}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Meetings"
              aria-current={surface === 'meetings' ? 'page' : undefined}
              onClick={() => onSelect('meetings')}
              className={cn(
                surface === 'meetings'
                  ? 'bg-surface-active text-text'
                  : 'text-text-muted hover:text-text-secondary dark:hover:text-text',
              )}
            >
              <Calendar aria-hidden className="size-4" />
            </Button>
          }
        />
        <TooltipContent side="bottom">Meetings</TooltipContent>
      </Tooltip>
    </nav>
  )
}
