import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'
import { SIDEBAR_ROW_HEIGHT_CLASS } from './sidebar-tree-icon'

interface SidebarPinnedRowPreviewProps {
  label: string
  active: boolean
  overlay?: boolean
  placeholder?: boolean
}

export function SidebarPinnedRowPreview({
  active,
  label,
  overlay = false,
  placeholder = false,
}: SidebarPinnedRowPreviewProps): ReactElement {
  const stateClass = placeholder
    ? 'bg-surface-hover text-transparent'
    : overlay
      ? 'bg-white text-text-secondary'
      : active
        ? 'bg-surface-hover text-text-secondary dark:bg-transparent'
        : 'text-text-secondary hover:bg-surface-hover hover:text-text'

  return (
    <span
      className={cn(
        SIDEBAR_ROW_HEIGHT_CLASS,
        'group flex w-full touch-none items-center rounded-md leading-5 transition-colors duration-[50ms]',
        stateClass,
        overlay && 'shadow-sm',
      )}
    >
      <span className={cn('min-w-0 flex-1 pl-3 pr-2.5 text-left', placeholder && 'invisible')}>
        <span className="block truncate text-xs font-medium">{label}</span>
      </span>
    </span>
  )
}
