import { useLayoutEffect, type ReactElement } from 'react'
import { parseCalloutMarker } from '@reflect/core'
import { useEditor } from '@meowdown/react'
import { whenEditorMounted } from './when-editor-mounted'

function firstLine(text: string): string {
  const breakAt = text.search(/\r?\n/)
  return (breakAt === -1 ? text : text.slice(0, breakAt)).trim()
}

function decorate(root: ParentNode): void {
  for (const quote of root.querySelectorAll('blockquote')) {
    const parsed = parseCalloutMarker(firstLine(quote.textContent ?? ''))
    if (parsed === null) {
      quote.removeAttribute('data-callout')
      continue
    }
    quote.setAttribute('data-callout', parsed.kind)
  }
}

/**
 * Paint GitHub-style `> [!NOTE]` blockquotes inside the live editor. meowdown
 * has no callout node, so the markdown stays a blockquote; this observer
 * stamps `data-callout` for CSS. Mounted as a NoteEditor child so it lives
 * for the editor session and disconnects on unmount.
 */
export function CalloutHighlighter(): ReactElement | null {
  const editor = useEditor()

  useLayoutEffect(() => {
    let observer: MutationObserver | null = null
    const cancelMount = whenEditorMounted(editor, () => {
      const root = editor.view.dom
      decorate(root)
      observer = new MutationObserver(() => {
        decorate(root)
      })
      observer.observe(root, { subtree: true, childList: true, characterData: true })
    })
    return () => {
      cancelMount()
      observer?.disconnect()
    }
  }, [editor])
  return null
}
