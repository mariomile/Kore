import type { ReactElement } from 'react'
import { Close, Pin } from '@/components/icons'
import { OpenTabIcon } from '@/components/open-tab-icon'
import { useOpenTabItems } from '@/hooks/use-open-tab-items'
import { cn } from '@/lib/utils'
import { tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'

/**
 * The sidebar's Open section mirrors every workspace tab. The active page
 * carries the selection tint and each row exposes the same close behavior as
 * the strip.
 */
export function SidebarOpenTabs(): ReactElement | null {
  const { activeTab, activateTab, closeTab } = useOpenTabs()
  const items = useOpenTabItems()
  const activeKey = activeTab === null ? null : tabKey(activeTab)

  if (items.length === 0) {
    return null
  }

  return (
    <div className="mt-6 px-2">
      <h2 className="px-2.5 pt-4 text-2xs font-medium leading-5 tracking-wide text-text-muted">
        Open
      </h2>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => {
          const isActive = tabKey(item.tab) === activeKey
          return (
            <li key={tabKey(item.tab)} className="group relative">
              <button
                type="button"
                onClick={() => {
                  activateTab(item.tab)
                }}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-7 text-left text-xs',
                  isActive
                    ? 'bg-surface-active font-medium text-text'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
              >
                {item.tab.pinned ? (
                  <Pin aria-hidden className="size-3.5 shrink-0 text-text-muted" />
                ) : (
                  <OpenTabIcon tab={item.tab} className="size-3.5 shrink-0 text-text-muted" />
                )}
                <span className="min-w-0 truncate">{item.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${item.title}`}
                onClick={() => {
                  closeTab(item.tab)
                }}
                className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Close aria-hidden className="size-3" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
