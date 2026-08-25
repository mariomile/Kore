import type { ReactElement } from 'react'
import { Calendar, Chat, Home, type Icon } from '@/components/icons'
import { ShortcutKeys } from '@/components/shortcut-keys'
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

interface SurfaceEntry {
  readonly id: SidebarSurface
  readonly label: string
  readonly icon: Icon
  readonly binding: string | null
}

const SURFACES: readonly SurfaceEntry[] = [
  { id: 'home', label: 'Home', icon: Home, binding: null },
  { id: 'chat', label: 'Chat', icon: Chat, binding: CHAT_BINDING },
  { id: 'meetings', label: 'Meetings', icon: Calendar, binding: null },
]

/**
 * The Notion-style surface bar: three pills that swap the rail below. The
 * selected pill wears its label; the others collapse to bare icons, so the
 * bar always spends its width on where you are. The label slides open
 * through an animated 0fr→1fr grid column (the same trick the disclosure
 * shelves use for height), with the wash and a small press scale carrying
 * the rest of the motion.
 */
export function SidebarSurfaceSwitcher({
  surface,
  onSelect,
}: SidebarSurfaceSwitcherProps): ReactElement {
  return (
    <nav aria-label="Sidebar surfaces" className="flex min-w-0 items-center gap-0.5">
      {SURFACES.map((entry) => {
        const active = surface === entry.id
        const Glyph = entry.icon
        return (
          <Tooltip key={entry.id}>
            <TooltipTrigger
              delay={700}
              render={
                <button
                  type="button"
                  aria-label={entry.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelect(entry.id)}
                  className={cn(
                    'flex h-7 items-center rounded-full px-2 text-[13px] font-medium',
                    // The expanded pill may shrink (truncating its label) so
                    // the title-bar band never overflows past the mic on a
                    // narrow rail; collapsed pills keep their icon footprint.
                    active ? 'min-w-0' : 'flex-none',
                    'transition-all duration-200 ease-swift outline-none select-none',
                    'focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]',
                    active
                      ? 'bg-surface-active text-text'
                      : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary dark:hover:text-text',
                  )}
                >
                  <Glyph aria-hidden className="size-4 flex-none" />
                  {/* The label column animates 0fr→1fr so the pill's width
                      eases rather than popping; the fade rides the same
                      curve so the text never shows mid-clip. */}
                  <span
                    aria-hidden
                    className={cn(
                      'grid transition-[grid-template-columns,opacity] duration-200 ease-swift',
                      active ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0',
                    )}
                  >
                    <span className="min-w-0 truncate pl-1.5 pr-0.5">{entry.label}</span>
                  </span>
                </button>
              }
            />
            <TooltipContent side="bottom">
              {entry.label}{' '}
              {entry.binding !== null ? <ShortcutKeys binding={entry.binding} /> : null}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}
