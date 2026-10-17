import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { CALLOUT_ALIASES, CALLOUT_KINDS, formatCalloutBlock, type CalloutKind } from '@reflect/core'
import type { NoteEditorHandle } from './note-editor'

function calloutKeywords(kind: CalloutKind): string[] {
  const aliases = Object.entries(CALLOUT_ALIASES)
    .filter(([, target]) => target === kind)
    .map(([alias]) => alias)
  return ['callout', kind, ...aliases]
}

/**
 * The editor's `/` menu rows for Obsidian callouts, one per kind (aliases
 * match as keywords). Selecting a row inserts `> [!NOTE]` (etc.) markdown;
 * meowdown stores it as a blockquote, and {@link CalloutHighlighter} paints
 * the kind.
 *
 * `getEditor` is read at select time so a late resolve after the pane
 * unmounted inserts nowhere rather than somewhere stale.
 */
export function useCalloutSlashItems(
  getEditor: () => NoteEditorHandle | null,
): SlashMenuSearchHandler {
  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> =>
      CALLOUT_KINDS.map((kind) => ({
        id: `callout:${kind}`,
        label: `Callout: ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
        keywords: calloutKeywords(kind),
        detail: 'Highlighted callout',
        onSelect: () => {
          getEditor()?.insertMarkdown(formatCalloutBlock(kind))
        },
      })),
    [getEditor],
  )
}
