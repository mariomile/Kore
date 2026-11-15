import { useMemo } from 'react'
import { Priority } from '@meowdown/core'
import { useExtension } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { createPageBlockPlugin, createPageKeyPlugin } from './page-block-plugin'

/**
 * Mounts sub-page cards in a NoteEditor (a NoteEditor child). The cards run
 * at normal priority, after the zoom whose state they read; the Backspace /
 * Delete guard runs high, before the list keymap could join text into a
 * hidden page.
 */
export function PageBlocks(): null {
  useExtension(useMemo(() => definePlugin(createPageBlockPlugin()), []))
  useExtension(
    useMemo(() => definePlugin(createPageKeyPlugin()), []),
    { priority: Priority.high },
  )
  return null
}
