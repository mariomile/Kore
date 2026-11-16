import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { startOperation } from '@/lib/operations'
import type { NoteEditorHandle } from './note-editor'

/**
 * The `/` menu's Page row: the caret's block becomes a page (a card the
 * reader taps into), the same as Turn into > Page in the block menu and on
 * iPhone, and ⌥⌘P.
 */
export function usePageSlashItems(getEditor: () => NoteEditorHandle | null): SlashMenuSearchHandler {
  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> => [
      {
        id: 'page',
        label: 'Page',
        keywords: ['sub page', 'subpage', 'card', 'nest', 'fold'],
        detail: 'Nest the block inside a card',
        onSelect: () => {
          const why = getEditor()?.togglePage?.() ?? null
          if (why !== null) startOperation('Turning into a page').fail(why)
        },
      },
    ],
    [getEditor],
  )
}
