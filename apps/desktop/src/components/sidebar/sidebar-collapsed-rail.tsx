import type { ReactElement } from 'react'
import type { GraphInfo } from '@kore/core'
import { AudioMemoButton } from '@/components/audio-memo/audio-memo-button'
import { GraphSwatch } from '@/components/graph-swatch'
import { Chat, PanelLeft, Search, Settings } from '@/components/icons'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGraphColors } from '@/hooks/use-graph-colors'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { keybindingFor } from '@/lib/commands/app-commands'
import { runCommand } from '@/lib/commands/registry'
import type { CommandContext } from '@/lib/commands/types'
import { useToday } from '@/lib/use-today'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/providers/sidebar-provider'
import { notePathForRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { navRowSpec, useVisibleSidebarNav } from './sidebar-nav'

interface SidebarCollapsedRailProps {
  graph: GraphInfo
  /** Commands run with this — the same context the palette/shortcuts use. */
  context: CommandContext
}

const PALETTE_BINDING = keybindingFor('palette.open')
const CHAT_BINDING = keybindingFor('chat.open')
const SETTINGS_BINDING = keybindingFor('settings.open')
const TOGGLE_SIDEBAR_BINDING = keybindingFor('sidebar.toggle')

const ICON_BUTTON_CLASS =
  'flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const ACTIVE_ICON_CLASS = 'bg-surface-active text-text dark:bg-surface-hover dark:text-accent'

/**
 * The collapsed left workspace rail: a slim vertical strip whose top band
 * owns the sidebar expand toggle, followed by search, primary navigation,
 * chat, audio capture, vault swatch, and settings — all centered on one
 * vertical axis.
 */
export function SidebarCollapsedRail({ graph, context }: SidebarCollapsedRailProps): ReactElement {
  const { route } = useRouter()
  const today = useToday()
  const pinned = usePinnedNotes()
  const { colorFor } = useGraphColors()
  const { toggleSidebar } = useSidebar()
  const visibleNav = useVisibleSidebarNav()
  const currentNotePath = notePathForRoute(route, today)
  const hasActivePinnedNote =
    currentNotePath !== null && pinned.some((note) => note.path === currentNotePath)
  const chatActive = route.kind === 'chat'
  const settingsActive = route.kind === 'settings'

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center">
      <div
        data-tauri-drag-region
        className="flex h-11 w-full flex-none items-center justify-center"
      >
        <div className="window-drag-control flex items-center justify-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Toggle sidebar"
                  aria-pressed={false}
                  onClick={toggleSidebar}
                  className={ICON_BUTTON_CLASS}
                >
                  <PanelLeft aria-hidden className="size-3.5" />
                </button>
              }
            />
            <TooltipContent side="right">
              Expand sidebar{' '}
              {TOGGLE_SIDEBAR_BINDING !== null ? (
                <ShortcutKeys binding={TOGGLE_SIDEBAR_BINDING} />
              ) : null}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Search"
                onClick={() => context.openPalette()}
                className={ICON_BUTTON_CLASS}
              >
                <Search aria-hidden className="size-3.5" />
              </button>
            }
          />
          <TooltipContent side="right">
            Search {PALETTE_BINDING !== null ? <ShortcutKeys binding={PALETTE_BINDING} /> : null}
          </TooltipContent>
        </Tooltip>

        {visibleNav.map((id) => {
          const spec = navRowSpec(id, { route, hasActivePinnedNote })
          const binding = keybindingFor(spec.commandId)
          return (
            <Tooltip key={id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={spec.label}
                    aria-current={spec.active ? 'page' : undefined}
                    onClick={() => void runCommand(spec.commandId, context)}
                    className={cn(ICON_BUTTON_CLASS, spec.active && ACTIVE_ICON_CLASS)}
                  >
                    <span aria-hidden className="flex items-center justify-center">
                      {spec.icon}
                    </span>
                  </button>
                }
              />
              <TooltipContent side="right">
                {spec.label} {binding !== null ? <ShortcutKeys binding={binding} /> : null}
              </TooltipContent>
            </Tooltip>
          )
        })}

        <div aria-hidden className="my-1 h-px w-5 bg-border" />

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Chat"
                aria-current={chatActive ? 'page' : undefined}
                onClick={() => void runCommand('chat.open', context)}
                className={cn(ICON_BUTTON_CLASS, chatActive && ACTIVE_ICON_CLASS)}
              >
                <Chat aria-hidden className="size-3.5" />
              </button>
            }
          />
          <TooltipContent side="right">
            Chat {CHAT_BINDING !== null ? <ShortcutKeys binding={CHAT_BINDING} /> : null}
          </TooltipContent>
        </Tooltip>

        <div className="flex size-8 items-center justify-center">
          <AudioMemoButton />
        </div>
      </div>

      <div className="mt-auto flex w-full flex-none flex-col items-center gap-1 py-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Expand sidebar (${graph.name})`}
                onClick={toggleSidebar}
                className="size-8 rounded-lg hover:bg-surface-hover"
              >
                <GraphSwatch color={colorFor(graph.root)} className="size-4 rounded-sm" />
              </Button>
            }
          />
          <TooltipContent side="right">
            {graph.name}{' '}
            {TOGGLE_SIDEBAR_BINDING !== null ? (
              <ShortcutKeys binding={TOGGLE_SIDEBAR_BINDING} />
            ) : null}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Open settings"
                aria-current={settingsActive ? 'page' : undefined}
                onClick={() => void runCommand('settings.open', context)}
                className={cn(
                  'size-8 rounded-lg text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text',
                  settingsActive && ACTIVE_ICON_CLASS,
                )}
              >
                <Settings aria-hidden className="size-3.5" />
              </Button>
            }
          />
          <TooltipContent side="right">
            Settings{' '}
            {SETTINGS_BINDING !== null ? <ShortcutKeys binding={SETTINGS_BINDING} /> : null}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
