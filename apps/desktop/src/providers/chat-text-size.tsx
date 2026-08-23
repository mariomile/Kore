import { useEffect, type ReactElement } from 'react'
import { useSettings } from '@/providers/settings-provider'

/**
 * Applies the AI chat's reading size to the document root.
 *
 * Mirrors the `chatTextSize` setting onto `[data-chat-text-size]` on
 * `<html>`, which `styles/index.css` maps to the `--chat-font-size` variable
 * every `.reflect-chat-message` surface reads. Side-effect-only (it renders
 * nothing): like the editor text size, the preference lives in the settings
 * document, so a choice made anywhere persists across launches and applies
 * to the chat route and the context-rail chat at once.
 */
export function ChatTextSizeEffect(): ReactElement | null {
  const { settings } = useSettings()
  const textSize = settings.chatTextSize

  useEffect(() => {
    document.documentElement.setAttribute('data-chat-text-size', textSize)
  }, [textSize])

  return null
}
