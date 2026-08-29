import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { formatEmbedBlock } from '@reflect/core'
import type { NoteEditorHandle } from './note-editor'

/** The URL the `/embed` row seeds, so the fence is valid the moment it lands. */
const URL_PLACEHOLDER = 'https://'
/** The markup the `/html` row seeds — a frame is the case the escape hatch exists for. */
const HTML_PLACEHOLDER = '<iframe src="https://" width="100%" height="400"></iframe>'

/**
 * The editor's `/` menu rows for embeds — the two blocks meowdown's built-in
 * menu (text, headings, lists, tasks, quote, code, math, table, file) has no
 * row for, because they are Kore's own.
 *
 * A URL row inserts a ` ```embed ` fence the note renders as a typed preview
 * card; the HTML row inserts the same fence around markup, rendered in a
 * sandboxed frame. Both stay plain fenced code in any other markdown editor.
 *
 * `getEditor` is read at select time: a late resolve after the pane unmounted
 * must insert nowhere rather than somewhere stale.
 */
export function useEmbedSlashItems(
  getEditor: () => NoteEditorHandle | null,
): SlashMenuSearchHandler {
  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> => [
      {
        id: 'embed:url',
        label: 'Embed a link',
        keywords: ['embed', 'link', 'url', 'video', 'youtube', 'preview', 'bookmark'],
        onSelect: () => {
          getEditor()?.insertMarkdown(
            `${formatEmbedBlock({ kind: 'url', url: URL_PLACEHOLDER, linkKind: 'link' })}\n`,
          )
        },
      },
      {
        id: 'embed:html',
        label: 'Embed HTML',
        keywords: ['embed', 'html', 'iframe', 'widget', 'raw'],
        onSelect: () => {
          getEditor()?.insertMarkdown(
            `${formatEmbedBlock({ kind: 'html', html: HTML_PLACEHOLDER })}\n`,
          )
        },
      },
    ],
    [getEditor],
  )
}
