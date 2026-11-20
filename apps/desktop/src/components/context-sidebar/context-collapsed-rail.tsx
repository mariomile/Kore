import type { ReactElement } from 'react'
import { Plus } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/providers/sidebar-provider'
import type { Route } from '@/routing/route'
import { contextPanelsBeside, visibleContextPanels, type ContextPanel } from './context-panel'

interface ContextCollapsedRailProps {
  /** Whether Details is offered on this route (matches ContextSidebar). */
  showDetails: boolean
  /** The route beside the rail; filters optional panels (e.g. hides Chat on chat route). */
  routeKind?: Route['kind'] | undefined
}

const ICON_BUTTON_CLASS =
  'flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/**
 * The collapsed right context rail: shows only the icons of the panels
 * currently open on the rail (Details plus any tabs added via "+"), along with
 * the "+" menu to open another. Clicking any icon expands the rail straight
 * onto that panel while keeping every heavy panel unmounted while collapsed.
 */
export function ContextCollapsedRail({
  showDetails,
  routeKind,
}: ContextCollapsedRailProps): ReactElement | null {
  const { contextPanels, openContextPanel, toggleContextSidebar } = useSidebar()
  const offered = contextPanelsBeside(routeKind)
  const segments = visibleContextPanels(showDetails, contextPanels.opened, routeKind)
  const active = segments.find((spec) => spec.id === contextPanels.active) ?? segments[0]

  if (segments.length === 0 && offered.length === 0) {
    return null
  }

  const expandTo = (id: ContextPanel): void => {
    haptic('alignment')
    openContextPanel(id)
    toggleContextSidebar()
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center pl-2">
      <div data-tauri-drag-region className="h-11 w-full flex-none" />

      <div className="mt-3 flex flex-col items-center gap-1">
        {segments.map(({ id, label, Glyph }) => {
          const isLastActive = active?.id === id
          return (
            <Tooltip key={id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Open ${label}`}
                    onClick={() => expandTo(id)}
                    className={cn(
                      ICON_BUTTON_CLASS,
                      isLastActive && 'bg-surface-hover/70 text-text-secondary',
                    )}
                  >
                    <Glyph aria-hidden className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent side="left">{label}</TooltipContent>
            </Tooltip>
          )
        })}

        {offered.length > 0 ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <button type="button" aria-label="Open a panel" className={ICON_BUTTON_CLASS}>
                        <Plus aria-hidden className="size-3.5" />
                      </button>
                    }
                  />
                }
              />
              <TooltipContent side="left">Open a panel</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="left" align="start" sideOffset={6} className="min-w-44">
              {offered.map(({ id, label, Glyph }) => (
                <DropdownMenuItem key={id} onClick={() => expandTo(id)}>
                  <Glyph aria-hidden className="size-3.5" />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}
