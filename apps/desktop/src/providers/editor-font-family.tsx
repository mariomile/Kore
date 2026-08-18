import { useEffect, type ReactElement } from 'react'
import { useSettings } from '@/providers/settings-provider'

/**
 * Applies the editor typeface family to the document root.
 *
 * Mirrors the `editorFontFamily` setting onto `[data-editor-font-family]` on
 * `<html>`, which `styles/index.css` maps to the `--editor-font-family`
 * variable the editor reads. This is a side-effect-only component (it renders
 * nothing): like the text-size effect, the preference lives in the settings
 * document, so a choice made anywhere persists across launches and applies to
 * every editor surface at once.
 */
export function EditorFontFamilyEffect(): ReactElement | null {
  const { settings } = useSettings()
  const fontFamily = settings.editorFontFamily

  useEffect(() => {
    document.documentElement.setAttribute('data-editor-font-family', fontFamily)
  }, [fontFamily])

  return null
}
