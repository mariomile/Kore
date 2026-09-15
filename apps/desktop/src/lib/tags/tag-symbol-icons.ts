import { createElement, type ReactElement } from 'react'
import type { IconProps } from '@/components/icons'
import { TAG_SYMBOL_ICONS } from './tag-symbol-icons.gen'

export { TAG_SYMBOL_ICONS }

/**
 * Render the symbol behind a stored name, or null for a name this build
 * lacks. A renderer rather than a component lookup: the component identity
 * is fixed in the generated table, so no component is created during render.
 */
export function renderSymbolIcon(name: string, props: IconProps): ReactElement | null {
  const Glyph = Object.hasOwn(TAG_SYMBOL_ICONS, name) ? TAG_SYMBOL_ICONS[name] : undefined
  return Glyph === undefined ? null : createElement(Glyph, props)
}
