import { useState, type ReactElement, type ReactNode } from 'react'
import type { OpenTab } from '@reflect/core'
import { Close, Pin, PinOff } from '@/components/icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { tabKey, tabsEqual } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'

/** The attribute a tab pill carries so the strip's menu knows which tab. */
export const TAB_KEY_ATTRIBUTE = 'data-tab-key'

interface TabContextMenuProps {
  /** The strip whose pills carry {@link TAB_KEY_ATTRIBUTE}. */
  children: ReactNode
}

/**
 * The right-click menu for a workspace tab, over the whole strip — same
 * one-menu-per-list shape as `NoteListContextMenu`: a capture-phase handler
 * resolves the clicked pill from its {@link TAB_KEY_ATTRIBUTE}, and the menu
 * mounts only once a pill has been right-clicked.
 */
export function TabContextMenu({ children }: TabContextMenuProps): ReactElement {
  const { tabs } = useOpenTabs()
  const [key, setKey] = useState<string | null>(null)
  const tab = key === null ? null : (tabs.find((open) => tabKey(open) === key) ?? null)

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="contents" />}>
        <div
          className="contents"
          onContextMenuCapture={(event) => {
            const pill = (event.target as Element).closest?.(`[${CSS.escape(TAB_KEY_ATTRIBUTE)}]`)
            const next = pill?.getAttribute(TAB_KEY_ATTRIBUTE) ?? null
            if (next === null) {
              // Not over a tab: swallow the event before Base UI's trigger
              // sees it, so the menu can never open on a stale tab.
              event.stopPropagation()
              return
            }
            setKey(next)
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      {tab === null ? null : <TabContextMenuItems tab={tab} />}
    </ContextMenu>
  )
}

function TabContextMenuItems({ tab }: { tab: OpenTab }): ReactElement {
  const { tabs, togglePin, closeTab, closeOtherTabs, closeTabsToRight, closeAllTabs } =
    useOpenTabs()
  const index = tabs.findIndex((open) => tabsEqual(open, tab))
  const hasOtherUnpinned = tabs.some((open) => !open.pinned && !tabsEqual(open, tab))
  const hasUnpinnedToRight = index !== -1 && tabs.slice(index + 1).some((open) => !open.pinned)
  const hasAnyUnpinned = tabs.some((open) => !open.pinned)

  return (
    <ContextMenuContent>
      <ContextMenuItem
        onClick={() => {
          togglePin(tab)
        }}
      >
        {tab.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {tab.pinned ? 'Unpin' : 'Pin'}
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem
        onClick={() => {
          closeTab(tab)
        }}
      >
        <Close aria-hidden />
        Close
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasOtherUnpinned}
        onClick={() => {
          closeOtherTabs(tab)
        }}
      >
        Close others
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasUnpinnedToRight}
        onClick={() => {
          closeTabsToRight(tab)
        }}
      >
        Close to the right
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasAnyUnpinned}
        onClick={() => {
          closeAllTabs()
        }}
      >
        Close all
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
