import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { useEditor } from '@meowdown/react'
import { NotePropertiesHeader } from '@/components/notes/note-properties-header'
import { cn } from '@/lib/utils'
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
      root?.classList.remove('reflect-editor-has-properties')
      root?.style.removeProperty('--reflect-note-properties-space')
      host?.classList.remove('reflect-note-properties-host')
      slotElement.style.removeProperty('top')
      delete slotElement.dataset.positioned
    }

    function measure(): void {
      if (root === null || host === null) return
      const title = root.querySelector<HTMLElement>(':scope > h1:first-child')
      const properties = slotElement.querySelector<HTMLElement>(
        ':scope > [aria-label="Properties"]',
      )
      if (title === null || properties === null) {
        clearPlacement()
        return
      }

      const hostRect = host.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      const appliedSpace =
        Number.parseFloat(root.style.getPropertyValue('--reflect-note-properties-space')) || 0
      const titleMargin = Math.max(
        0,
        (Number.parseFloat(getComputedStyle(title).marginBottom) || 0) - appliedSpace,
      )
      const top = titleRect.bottom - hostRect.top + titleMargin
      const space = slotElement.getBoundingClientRect().height

      host.classList.add('reflect-note-properties-host')
      root.classList.add('reflect-editor-has-properties')
      root.style.setProperty('--reflect-note-properties-space', `${space}px`)
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
        const title = root?.querySelector<HTMLElement>(':scope > h1:first-child')
        if (title !== null && title !== undefined) resizeObserver?.observe(title)
        resizeObserver?.observe(slotElement)
        measure()
      })
      mutationObserver.observe(root, { childList: true, subtree: true })
      mutationObserver.observe(slotElement, { childList: true, subtree: true })

      const title = root.querySelector<HTMLElement>(':scope > h1:first-child')
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
    <div ref={slotRef} className={cn('reflect-note-properties-slot', className)}>
      <NotePropertiesHeader path={path} />
    </div>
  )
}
