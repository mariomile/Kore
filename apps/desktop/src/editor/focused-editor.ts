import { useMemo } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { Plugin } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'

/**
 * The note editor that last had focus, for editor commands run from outside
 * the editor (the palette's Zoom, Copy link to line, Move block to note). One
 * registry, fed by the plugin `NoteEditor` mounts on every editor.
 */

let lastFocused: EditorView | null = null

/** The last focused editor while it is still mounted, else null. */
export function lastFocusedEditor(): EditorView | null {
  const view = lastFocused
  return view !== null && !view.isDestroyed && view.dom.isConnected ? view : null
}

/** Records focus: on the focus event, and on any update while focused (focus can predate mount). */
function createFocusedEditorPlugin(): Plugin {
  return new Plugin({
    view: (editorView) => {
      if (editorView.hasFocus()) {
        lastFocused = editorView
      }
      return {
        update: (view) => {
          if (view.hasFocus()) {
            lastFocused = view
          }
        },
        destroy: () => {
          if (lastFocused === editorView) {
            lastFocused = null
          }
        },
      }
    },
    props: {
      handleDOMEvents: {
        focus: (view) => {
          lastFocused = view
          return false
        },
      },
    },
  })
}

/** Mounts the focus record inside an editor (a `NoteEditor` child). */
export function FocusedEditorTracker(): null {
  useExtension(useMemo(() => definePlugin(createFocusedEditorPlugin()), []))
  return null
}
