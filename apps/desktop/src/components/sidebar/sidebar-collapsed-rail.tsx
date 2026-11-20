import type { ReactElement, ReactNode } from 'react'
import type { GraphInfo } from '@kore/core'
import { AudioMemoButton } from '@/components/audio-memo/audio-memo-button'
import { GraphSwatch } from '@/components/graph-swatch'
import { Chat, PanelLeft, Search, Settings } from '@/components/icons'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGraphColors } from '@/hooks/use-graph-colors'
import { keybindingFor } from '@/lib/commands/app-commands'
import { runCommand } from '@/lib/commands/registry'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/providers/sidebar-provider'
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

interface RailIconButtonProps {
  label: string
  tooltip?: string
  binding?: string | null
  active?: boolean
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}

function RailIconButton({
  label,
  tooltip = label,
  binding = null,
  active = false,
  pressed,
  onClick,
  children,
}: RailIconButtonProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(ICON_BUTTON_CLASS, active && ACTIVE_ICON_CLASS)}
          >
            <span aria-hidden className="flex items-center justify-center">
              {children}
            </span>
          </button>
        }
      />
      <TooltipContent side="right">
        {tooltip} {binding !== null ? <ShortcutKeys binding={binding} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The collapsed left workspace rail: a slim vertical strip whose top band
 * owns the sidebar expand toggle, followed by search, primary navigation,
 * chat, audio capture, vault swatch, and settings — all centered on one
 * vertical axis.
 */
export function SidebarCollapsedRail({ graph, context }: SidebarCollapsedRailProps): ReactElement {
  const { route } = useRouter()
  const { colorFor } = useGraphColors()
  const { toggleSidebar } = useSidebar()
  const visibleNav = useVisibleSidebarNav()

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center">
      <div
        data-tauri-drag-region
        className="flex h-11 w-full flex-none items-center justify-center"
      >
        <div className="window-drag-control flex items-center justify-center">
          <RailIconButton
            label="Toggle sidebar"
            tooltip="Expand sidebar"
            binding={TOGGLE_SIDEBAR_BINDING}
            pressed={false}
            onClick={toggleSidebar}
          >
            <PanelLeft className="size-3.5" />
          </RailIconButton>
        </div>
      </div>

      <div className="mt-3 flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        <RailIconButton
          label="Search"
          binding={PALETTE_BINDING}
          onClick={() => context.openPalette()}
        >
          <Search className="size-3.5" />
        </RailIconButton>

        {visibleNav.map((id) => {
          const spec = navRowSpec(id, { route, hasActivePinnedNote: false })
          return (
            <RailIconButton
              key={id}
              label={spec.label}
              binding={keybindingFor(spec.commandId)}
              active={spec.active}
              onClick={() => void runCommand(spec.commandId, context)}
            >
              {spec.icon}
            </RailIconButton>
          )
        })}

        <div aria-hidden className="my-1 h-px w-5 bg-border" />

        <RailIconButton
          label="Chat"
          binding={CHAT_BINDING}
          active={route.kind === 'chat'}
          onClick={() => void runCommand('chat.open', context)}
        >
          <Chat className="size-3.5" />
        </RailIconButton>

        <div className="flex size-8 items-center justify-center">
          <AudioMemoButton />
        </div>
      </div>

      <div className="mt-auto flex w-full flex-none flex-col items-center gap-1 py-3">
        <RailIconButton
          label={`Expand sidebar (${graph.name})`}
          tooltip={graph.name}
          binding={TOGGLE_SIDEBAR_BINDING}
          onClick={toggleSidebar}
        >
          <GraphSwatch color={colorFor(graph.root)} className="size-4 rounded-sm" />
        </RailIconButton>

        <RailIconButton
          label="Open settings"
          tooltip="Settings"
          binding={SETTINGS_BINDING}
          active={route.kind === 'settings'}
          onClick={() => void runCommand('settings.open', context)}
        >
          <Settings className="size-3.5" />
        </RailIconButton>
      </div>
    </div>
  )
}
