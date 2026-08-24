import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { CALLOUT_KINDS, formatCalloutBlock, type CalloutKind } from '@reflect/core'
import type { NoteEditorHandle } from './note-editor'

const CALLOUT_ROWS: { kind: CalloutKind; label: string; keywords: string[] }[] = [
  { kind: 'note', label: 'Callout: Note', keywords: ['callout', 'note', 'info', 'alert'] },
  { kind: 'tip', label: 'Callout: Tip', keywords: ['callout', 'tip', 'hint'] },
  {
    kind: 'important',
    label: 'Callout: Important',
    keywords: ['callout', 'important', 'alert'],
  },
  { kind: 'warning', label: 'Callout: Warning', keywords: ['callout', 'warning'] },
  { kind: 'caution', label: 'Callout: Caution', keywords: ['callout', 'caution', 'danger'] },
]

/**
 * The editor's `/` menu rows for GitHub-style alert callouts. Selecting a
 * row inserts `> [!NOTE]` (etc.) markdown; meowdown stores it as a
 * blockquote, and {@link CalloutHighlighter} paints the kind.
 *
 * `getEditor` is read at select time so a late resolve after the pane
 * unmounted inserts nowhere rather than somewhere stale.
 */
export function useCalloutSlashItems(
  getEditor: () => NoteEditorHandle | null,
): SlashMenuSearchHandler {
  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> =>
      CALLOUT_ROWS.filter((row) => CALLOUT_KINDS.includes(row.kind)).map((row) => ({
        id: `callout:${row.kind}`,
        label: row.label,
        keywords: row.keywords,
        onSelect: () => {
          getEditor()?.insertMarkdown(formatCalloutBlock(row.kind))
        },
      })),
    [getEditor],
  )
}
