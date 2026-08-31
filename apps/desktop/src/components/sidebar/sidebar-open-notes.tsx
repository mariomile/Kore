import { useState, type ReactElement } from 'react'
import { Close, Pin } from '@/components/icons'
import { OpenTabIcon } from '@/components/open-tab-icon'
import { useOpenTabItems } from '@/hooks/use-open-tab-items'
import { cn } from '@/lib/utils'
import { tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { SidebarSortableSection } from './sidebar-sortable-section'

/**
 * How many open tabs the shelf lists before it collapses the rest behind
 * "Show more". A long session opens dozens of tabs, and a shelf that grows
 * without a ceiling pushes Pinned and Tags off the rail entirely.
 */
const VISIBLE_LIMIT = 8

/**
 * The sidebar's Open section mirrors every workspace tab. The active page
 * carries the selection tint and each row exposes the same close behavior as
 * the strip. Like the other shelves it is a collapsible, reorderable section;
 * beyond {@link VISIBLE_LIMIT} rows the rest wait behind "Show more".
 */
export function SidebarOpenTabs(): ReactElement | null {
  const { activeTab, activateTab, closeTab } = useOpenTabs()
  const items = useOpenTabItems()
  const [expanded, setExpanded] = useState(false)
  const activeKey = activeTab === null ? null : tabKey(activeTab)

  if (items.length === 0) {
    return null
  }

  const overflow = items.length - VISIBLE_LIMIT
  const visible = expanded ? items : items.slice(0, VISIBLE_LIMIT)

  return (
    <SidebarSortableSection id="open" title="Open" label="Open">
      <div className="-mx-2.5 mt-2">
        <ul className="space-y-0.5">
          {visible.map((item) => {
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
                    'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2.5 pr-7 text-left text-xs',
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
        {overflow > 0 ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(!expanded)
            }}
            className="mt-0.5 flex h-7 w-full items-center rounded-md px-2.5 text-xs font-medium text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text"
          >
            {expanded ? 'Show less' : `Show ${overflow} more`}
          </button>
        ) : null}
      </div>
    </SidebarSortableSection>
  )
}
