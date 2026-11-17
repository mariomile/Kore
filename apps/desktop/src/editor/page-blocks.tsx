import { useMemo, useRef } from 'react'
import { Priority, type EditorExtension } from '@meowdown/core'
import { useEditor, useExtension, useKeymap } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { startOperation } from '@/lib/operations'
import { PAGE_BINDING, togglePageAtCaret } from './page-block-commands'
import { createPageBlockPlugin, createPageKeyPlugin } from './page-block-plugin'

/**
 * Mounts sub-page cards in a NoteEditor (a NoteEditor child). The cards run
 * at normal priority, after the zoom whose state they read; the Backspace /
 * Delete guard runs high, before the list keymap could join text into a
 * hidden page. ⌥⌘P turns the caret's block into a page.
 *
 * `onOpenPage` lets the surface open a tapped page somewhere else than in
 * place (`PageBlockOptions.openPage`).
 */
export function PageBlocks({
  onOpenPage,
}: { readonly onOpenPage?: (id: string) => boolean } = {}): null {
  const editor = useEditor<EditorExtension>()
  const openRef = useRef(onOpenPage)
  openRef.current = onOpenPage
  useExtension(
    useMemo(
      () =>
        definePlugin(
          createPageBlockPlugin({
            openPage: (id) => openRef.current?.(id) ?? false,
          }),
        ),
      [],
    ),
  )
  useExtension(
    useMemo(() => definePlugin(createPageKeyPlugin()), []),
    { priority: Priority.high },
  )
  useKeymap(
    useMemo(
      () => ({
        [PAGE_BINDING]: () => {
          const why = togglePageAtCaret(editor)
          if (why !== null) startOperation('Turning into a page').fail(why)
          return true
        },
      }),
      [editor],
    ),
    { priority: Priority.high },
  )
  return null
}
