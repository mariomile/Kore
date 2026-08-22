import type { ReactElement, ReactNode } from 'react'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { SidebarIconSlot } from './sidebar-icon-slot'
import { cn } from '@/lib/utils'

interface SidebarItemProps {
  /** A 15px SF-style glyph — the glass tile supplies the 24px footprint. */
  icon: ReactNode
  label: string
  /** Keymap binding hinted on hover/focus (e.g. `Mod-d`). */
  binding?: string | undefined
  active?: boolean
  onClick: () => void
}

/**
 * One primary-navigation row: a liquid-glass icon tile + medium label on a
 * translucent hover wash; selected rows keep the wash in light mode and tint
 * the text brand-indigo in dark, with the keyboard shortcut revealed on
 * hover — chrome that teaches the fast path.
 */
export function SidebarItem({
  icon,
  label,
  binding,
  active = false,
  onClick,
}: SidebarItemProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center space-x-3 rounded-md px-2.5 py-(--nav-padding-y) text-sm font-medium',
        'transition-colors duration-100',
        active
          ? 'bg-surface-hover text-text dark:bg-transparent dark:text-accent'
          : 'text-text hover:bg-surface-hover',
      )}
    >
      <SidebarIconSlot>{icon}</SidebarIconSlot>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {binding ? (
        <ShortcutKeys
          binding={binding}
          className="invisible group-hover:visible group-focus-visible:visible"
        />
      ) : null}
    </button>
  )
}
