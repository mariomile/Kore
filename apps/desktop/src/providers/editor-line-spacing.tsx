import { useEffect, type ReactElement } from 'react'
import { useSettings } from '@/providers/settings-provider'

/**
 * Applies the editor line spacing to the document root.
 *
 * Mirrors the `editorLineSpacing` setting onto `[data-editor-line-spacing]`
 * on `<html>`, which `styles/index.css` maps to a prose line-height override
 * on the note surface (`normal` declares nothing, keeping the editor's stock
 * rhythm). Side-effect-only, same contract as the text-size effect.
 */
export function EditorLineSpacingEffect(): ReactElement | null {
  const { settings } = useSettings()
  const lineSpacing = settings.editorLineSpacing

  useEffect(() => {
    document.documentElement.setAttribute('data-editor-line-spacing', lineSpacing)
  }, [lineSpacing])

  return null
}
