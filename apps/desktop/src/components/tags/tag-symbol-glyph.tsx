import { createElement, type ReactElement } from 'react'
import type { IconProps } from '@/components/icons'
import { useTagSymbolIcons } from '@/lib/tags/tag-symbol-icons'

interface TagSymbolGlyphProps extends IconProps {
  /** The stored symbol name (the part after `icon:`). */
  name: string
  /** Drawn while the symbol table loads, or for a name this build lacks. */
  fallback: ReactElement | null
}

/**
 * One app symbol by its stored name. Mounting it is what fetches the symbol
 * table, so screens that show no symbol never load it.
 */
export function TagSymbolGlyph({
  name,
  fallback,
  ...props
}: TagSymbolGlyphProps): ReactElement | null {
  const icons = useTagSymbolIcons()
  const Glyph = icons !== null && Object.hasOwn(icons, name) ? icons[name] : undefined
  return Glyph === undefined ? fallback : createElement(Glyph, props)
}
