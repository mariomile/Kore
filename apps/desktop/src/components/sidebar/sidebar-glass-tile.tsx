import type { ReactElement, ReactNode } from 'react'

interface SidebarGlassTileProps {
  children: ReactNode
}

/**
 * macOS Tahoe liquid-glass well for a sidebar glyph: a 24px superellipse
 * with a translucent fill, specular top sheen, and a hairline refraction
 * edge. Selected and hover tints are driven from the parent row's
 * `aria-current` / `:hover` so every nav icon shares one material.
 */
export function SidebarGlassTile({ children }: SidebarGlassTileProps): ReactElement {
  return (
    <span aria-hidden className="sidebar-glass-tile">
      {children}
    </span>
  )
}
