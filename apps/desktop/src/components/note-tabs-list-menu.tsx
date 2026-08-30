import type { ReactElement } from 'react'
import { Check, ChevronDown } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { OpenTabIcon } from '@/components/open-tab-icon'
import { useOpenTabItems } from '@/hooks/use-open-tab-items'
import { tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'

/**
 * The tab strip's "list all tabs" menu: every open tab by name, the active
 * one checked. This is the overflow affordance — pills shrink and scroll on
 * a crowded strip, and the menu keeps each tab one click away by its full
 * title — but it stays useful on a short strip too, so it is always there
 * (the same call browsers made with their tab-search menus).
 */
export function NoteTabsListMenu(): ReactElement | null {
  const { tabs, activeTab, activateTab } = useOpenTabs()
  const items = useOpenTabItems()
  if (tabs.length < 2) {
    // One tab lists nothing worth a menu.
    return null
  }
  const activeKey = activeTab === null ? null : tabKey(activeTab)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="List open tabs"
            title="List open tabs"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-surface-hover hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.97]"
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="max-h-96 min-w-52 overflow-y-auto">
        {items.map((item) => {
          const key = tabKey(item.tab)
          const active = key === activeKey
          return (
            <DropdownMenuItem
              key={key}
              onClick={() => {
                activateTab(item.tab)
              }}
            >
              <OpenTabIcon tab={item.tab} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {active ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
