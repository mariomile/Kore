import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { useEditor } from '@meowdown/react'
import { NotePropertiesHeader } from '@/components/notes/note-properties-header'
import { cn } from '@/lib/utils'
import {
  applyMembershipParagraphCss,
  clearMembershipParagraphCss,
} from './tag-membership-paragraph'
import { applyNoteTitleCss, clearNoteTitleCss, findNoteTitle } from './note-title-placement'
import { whenEditorMounted } from './when-editor-mounted'

interface EditorNotePropertiesProps {
  /** Graph-relative path of the note whose typed fields are shown. */
  path: string
  /** The same content gutter used by the note editor. */
  className?: string
}

/**
 * Places a typed note's properties between its leading H1 and body without
 * moving the H1 out of the Markdown editor. The slot stays outside
 * ProseMirror's document DOM, while measured title and slot heights reserve
 * exactly the space it occupies inside the page flow.
 */
export function EditorNoteProperties({ path, className }: EditorNotePropertiesProps): ReactElement {
  const editor = useEditor()
  const slotRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (slot === null) return
    const slotElement = slot

    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let root: HTMLElement | null = null
    let host: HTMLElement | null = null

    function clearPlacement(): void {
      clearMembershipParagraphCss(host)
      clearNoteTitleCss(host)
      root?.classList.remove('kore-editor-has-properties', 'kore-editor-properties-top')
      root?.style.removeProperty('--kore-note-properties-space')
      host?.classList.remove('kore-note-properties-host')
      slotElement.style.removeProperty('top')
      delete slotElement.dataset.positioned
    }

    function measure(): void {
      if (root === null || host === null) return
      // The title may sit behind blank lines (a blank line after the
      // frontmatter, the way Obsidian writes notes, parses as an empty
      // paragraph), and a note may have no H1 at all (its name is the file
      // name). Either way a typed note still shows its fields: below the
      // title when there is one, at the top of the body when there is not.
      const title = findNoteTitle(root)
      const properties = slotElement.querySelector<HTMLElement>(
        ':scope > [aria-label="Properties"]',
      )
      // A title-less note with nothing to show keeps no slot: "Add a type"
      // is offered beside a title, never above an arbitrary first line.
      const bare = properties?.hasAttribute('data-bare-properties') ?? false
      if (properties === null || (title === null && bare)) {
        clearPlacement()
        return
      }

      const hostRect = host.getBoundingClientRect()
      const space = slotElement.getBoundingClientRect().height
      let top: number
      if (title !== null) {
        const titleRect = title.getBoundingClientRect()
        const appliedSpace =
          Number.parseFloat(root.style.getPropertyValue('--kore-note-properties-space')) || 0
        const titleMargin = Math.max(
          0,
          (Number.parseFloat(getComputedStyle(title).marginBottom) || 0) - appliedSpace,
        )
        top = titleRect.bottom - hostRect.top + titleMargin
        root.classList.remove('kore-editor-properties-top')
        applyNoteTitleCss(host, root, title)
      } else {
        top = root.getBoundingClientRect().top - hostRect.top
        root.classList.add('kore-editor-properties-top')
        clearNoteTitleCss(host)
      }

      host.classList.add('kore-note-properties-host')
      root.classList.add('kore-editor-has-properties')
      applyMembershipParagraphCss(host, root, title)
      root.style.setProperty('--kore-note-properties-space', `${space}px`)
      slotElement.style.setProperty('top', `${top}px`)
      slotElement.dataset.positioned = 'true'
    }

    const cancelMount = whenEditorMounted(editor, () => {
      root = editor.view.dom
      host = slotElement.closest<HTMLElement>('.meowdown')
      if (host === null) return

      resizeObserver = new ResizeObserver(measure)
      resizeObserver.observe(slotElement)

      mutationObserver = new MutationObserver(() => {
        resizeObserver?.disconnect()
        const title = root === null ? null : findNoteTitle(root)
        if (title !== null) resizeObserver?.observe(title)
        resizeObserver?.observe(slotElement)
        measure()
      })
      mutationObserver.observe(root, { childList: true, subtree: true })
      mutationObserver.observe(slotElement, { childList: true, subtree: true })

      const title = findNoteTitle(root)
      if (title !== null) resizeObserver.observe(title)
      measure()
    })

    return () => {
      cancelMount()
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      clearPlacement()
    }
  }, [editor])

  return (
    <div ref={slotRef} className={cn('kore-note-properties-slot', className)}>
      <NotePropertiesHeader path={path} />
    </div>
  )
}
