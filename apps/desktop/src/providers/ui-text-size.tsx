import { useEffect, type ReactElement } from 'react'
import { useSettings } from '@/providers/settings-provider'

/**
 * Applies the interface text size to the document root.
 *
 * Mirrors the `uiTextSize` setting onto `[data-ui-text-size]` on `<html>`,
 * which `styles/index.css` maps to a root font-size scale — every rem-based
 * size in the app follows. Like the density scope, `default` declares
 * nothing, so the attribute is removed rather than set to keep the cascade
 * one level shallower. Side-effect-only; it renders nothing.
 */
export function UiTextSizeEffect(): ReactElement | null {
  const { settings } = useSettings()
  const textSize = settings.uiTextSize

  useEffect(() => {
    if (textSize === 'default') {
      document.documentElement.removeAttribute('data-ui-text-size')
    } else {
      document.documentElement.setAttribute('data-ui-text-size', textSize)
    }
  }, [textSize])

  return null
}
