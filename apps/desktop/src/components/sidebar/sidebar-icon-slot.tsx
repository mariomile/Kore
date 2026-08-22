import type { ReactElement, ReactNode } from 'react'

interface SidebarIconSlotProps {
  children: ReactNode
}

/**
 * The fixed 24px box a nav or palette glyph sits in, so every label starts on
 * the same vertical line however wide its icon draws. It paints nothing of its
 * own: selected and hover tints come from the parent row's `aria-current` /
 * `data-selected` / `:hover`, so the whole column shares one color story.
 */
export function SidebarIconSlot({ children }: SidebarIconSlotProps): ReactElement {
  return (
    <span aria-hidden className="sidebar-icon-slot">
      {children}
    </span>
  )
}
