import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'
import type { SettingsGroupId } from './sections'
import type { VisibleSettingsGroup } from './use-visible-settings-sections'

interface SettingsNavigatorProps {
  groups: readonly VisibleSettingsGroup[]
  activeGroupId: SettingsGroupId
  onSelectGroup: (id: SettingsGroupId) => void
  className?: string
}

/**
 * Settings' local page navigation. Groups are the pages: section-level
 * controls stay together instead of becoming one long document of anchors.
 */
export function SettingsNavigator({
  groups,
  activeGroupId,
  onSelectGroup,
  className,
}: SettingsNavigatorProps): ReactElement {
  return (
    <nav aria-label="Settings pages" className={cn('flex flex-col gap-1', className)}>
      {groups.map((group) => {
        const isActive = group.id === activeGroupId
        return (
          <button
            key={group.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelectGroup(group.id)}
            className={cn(
              'rounded-md px-2.5 py-2 text-left text-[13px] font-medium outline-none transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-focus-ring',
              isActive
                ? 'bg-surface-active text-text'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text',
            )}
          >
            {group.title}
          </button>
        )
      })}
    </nav>
  )
}
