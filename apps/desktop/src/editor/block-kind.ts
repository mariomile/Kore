import type { Editor } from '@prosekit/core'
import type { EditorExtension } from '@meowdown/core'
import type { FormattingBlockKind } from './formatting-toolbar-store'
import { setZoom, zoomTarget } from './block-zoom-state'
import { parentTarget, targetSpan } from './block-zoom-target'
import { allowCaretInPage } from './page-block-plugin'

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

/**
 * Back to a plain paragraph: out of any list or quote, heading dropped.
 *
 * Inside a zoom the zoom refuses an unwrap that would carry the line out of
 * the zoomed block, while `unwrapList` still reports it can run: stop at the
 * first unwrap that changes nothing, or the loop would spin forever (the
 * phone froze on "Turn into Text" inside an open page).
 */
function toText(editor: KoreEditor): void {
  while (editor.commands.unwrapList.canExec()) {
    const before = editor.state.doc
    editor.commands.unwrapList()
    if (editor.state.doc === before) break
  }
  if (readBlockKind(editor) === 'quote') editor.commands.toggleBlockquote()
  editor.commands.setParagraph()
}

/**
 * Turn the caret's block into `kind`. Asking for the kind it already is
 * changes nothing (Craft: the lit pill is a no-op).
 */
export function setBlockKind(editor: KoreEditor, kind: FormattingBlockKind): void {
  if (kind === readBlockKind(editor)) return
  leaveZoomedLine(editor)
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

/**
 * The caret on the zoomed block's own line (an open page's title, a zoomed
 * heading) asks to change the block the zoom stands on, which the zoom would
 * refuse. Step out to the zoom's parent first, so the change happens and the
 * reader sees the block it became where it now lives.
 */
function leaveZoomedLine(editor: KoreEditor): void {
  const { state } = editor
  let target = zoomTarget(state)
  if (target === null) return
  const { $from } = state.selection
  if ($from.depth === 0) return
  const line = $from.before($from.depth)
  const span = targetSpan(state.doc, target)
  const own =
    span !== null && (target.kind === 'list' ? line === span.from + 1 : line === span.from)
  if (!own) return
  target = parentTarget(state.doc, target)
  // The caret stays on its line even when that line is a page's, which
  // reads as a card once the zoom is gone: the change below acts on it.
  editor.view.dispatch(allowCaretInPage(setZoom(state.tr, target)))
}
