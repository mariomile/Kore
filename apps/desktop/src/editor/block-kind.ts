import type { Editor } from '@prosekit/core'
import type { EditorExtension } from '@meowdown/core'
import type { FormattingBlockKind } from './formatting-toolbar-store'

type KoreEditor = Editor<EditorExtension>

/**
 * The block kind under the caret, as the iPhone's block pills name them: a
 * heading, the nearest list's kind (task or bullet), a quote, or plain text.
 */
export function readBlockKind(editor: KoreEditor): FormattingBlockKind {
  const { $from } = editor.state.selection
  if ($from.parent.type.name === 'heading') return 'heading'
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'list') {
      const attrs = node.attrs as { kind?: string }
      return attrs.kind === 'task' ? 'task' : 'bullet'
    }
    if (node.type.name === 'blockquote') return 'quote'
  }
  return 'text'
}

/** Back to a plain paragraph: out of any list or quote, heading dropped. */
function toText(editor: KoreEditor): void {
  while (editor.commands.unwrapList.canExec()) editor.commands.unwrapList()
  if (readBlockKind(editor) === 'quote') editor.commands.toggleBlockquote()
  editor.commands.setParagraph()
}

/**
 * Turn the caret's block into `kind`. Asking for the kind it already is
 * changes nothing (Craft: the lit pill is a no-op).
 */
export function setBlockKind(editor: KoreEditor, kind: FormattingBlockKind): void {
  if (kind === readBlockKind(editor)) return
  toText(editor)
  switch (kind) {
    case 'heading':
      editor.commands.setHeading({ level: 2 })
      break
    case 'bullet':
      editor.commands.wrapInList({ kind: 'bullet' })
      break
    case 'task':
      editor.commands.wrapInList({ kind: 'task' })
      break
    case 'quote':
      editor.commands.toggleBlockquote()
      break
    case 'text':
      break
  }
}
