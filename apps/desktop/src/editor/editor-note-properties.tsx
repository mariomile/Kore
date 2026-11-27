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
      // Forced toggles, not `remove`: this runs per keystroke on a note
      // without properties, and `remove` rewrites the class attribute even
      // when the class is already absent.
      root?.classList.toggle('kore-editor-has-properties', false)
      root?.classList.toggle('kore-editor-properties-top', false)
      root?.style.removeProperty('--kore-note-properties-space')
      host?.classList.toggle('kore-note-properties-host', false)
      slotElement.style.removeProperty('top')
      if (slotElement.dataset.positioned !== undefined) {
        delete slotElement.dataset.positioned
      }
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
        root.classList.toggle('kore-editor-properties-top', false)
        applyNoteTitleCss(host, root, title)
      } else {
        top = root.getBoundingClientRect().top - hostRect.top
        root.classList.toggle('kore-editor-properties-top', true)
        clearNoteTitleCss(host)
      }

      // `toggle` with a force leaves the attribute alone when the class is
      // already right; `add` rewrites it and queues a mutation record for
      // every observer of the editor. This runs on every keystroke.
      host.classList.toggle('kore-note-properties-host', true)
      root.classList.toggle('kore-editor-has-properties', true)
      applyMembershipParagraphCss(host, root, title)
      // Write only what moved: each inline-style write restyles the editor,
      // and this runs after every structural edit.
      setStyleIfChanged(root, '--kore-note-properties-space', `${space}px`)
      setStyleIfChanged(slotElement, 'top', `${top}px`)
      if (slotElement.dataset.positioned !== 'true') {
        slotElement.dataset.positioned = 'true'
      }
    }

    // Edits mutate the document many times per frame (a keystroke, a paste,
    // a collaborator's batch). Measuring once per frame, in the frame's
    // animation callback, reads a layout the frame needs anyway instead of
    // forcing one per mutation record.
    let measureFrame: number | null = null
    function scheduleMeasure(): void {
      if (measureFrame !== null) return
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null
        measure()
      })
    }

    const cancelMount = whenEditorMounted(editor, () => {
      root = editor.view.dom
      host = slotElement.closest<HTMLElement>('.meowdown')
      if (host === null) return

      resizeObserver = new ResizeObserver(measure)
      resizeObserver.observe(slotElement)

      // Watch the title element for size changes, re-pointing the watch only
      // when an edit replaced it: a fresh `observe` always reports once, so
      // re-observing on every mutation measured twice per keystroke.
      let observedTitle = findNoteTitle(root)
      if (observedTitle !== null) resizeObserver.observe(observedTitle)

      mutationObserver = new MutationObserver(() => {
        const title = root === null ? null : findNoteTitle(root)
        if (title !== observedTitle) {
          if (observedTitle !== null) resizeObserver?.unobserve(observedTitle)
          if (title !== null) resizeObserver?.observe(title)
          observedTitle = title
        }
        scheduleMeasure()
      })
      mutationObserver.observe(root, { childList: true, subtree: true })
      mutationObserver.observe(slotElement, { childList: true, subtree: true })
      measure()
    })

    return () => {
      cancelMount()
      if (measureFrame !== null) cancelAnimationFrame(measureFrame)
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

function setStyleIfChanged(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value)
  }
}
