import { useMemo } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { AllSelection, Plugin, PluginKey, TextSelection, type Selection } from '@prosekit/pm/state'
import { Decoration, DecorationSet } from '@prosekit/pm/view'

/**
 * Keeps a text selection hugging the text, the way Craft and Notion draw it.
 *
 * WebKit (the Mac and iPhone webview) fills "selection gaps": every selected
 * line is extended to the edges of the editor, so a selection across a few
 * tasks paints full-width slabs that also cover the checkbox and bullet
 * column. WebKit skips that fill inside a transformed block, so each textblock
 * the selection touches gets a class whose CSS (`kore-selection-block` in
 * index.css) is an identity `translate`. Only those blocks, and only while a
 * range is selected: a caret costs nothing, and no block carries a layer the
 * rest of the time. Chromium paints no gaps and is unaffected.
 */

export const SELECTION_BLOCK_CLASS = 'kore-selection-block'

const selectionShapeKey = new PluginKey<DecorationSet>('kore-selection-shape')

/** Whether this selection paints text highlight (a non-empty text range). */
function isTextRange(selection: Selection): boolean {
  return (
    !selection.empty && (selection instanceof TextSelection || selection instanceof AllSelection)
  )
}

/** One node decoration per textblock the selection touches; empty for a caret. */
export function selectionBlockDecorations(
  doc: ProseMirrorNode,
  selection: Selection,
): DecorationSet {
  if (!isTextRange(selection)) {
    return DecorationSet.empty
  }
  const decorations: Decoration[] = []
  for (const range of selection.ranges) {
    doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) {
        return true
      }
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: SELECTION_BLOCK_CLASS }))
      return false
    })
  }
  return DecorationSet.create(doc, decorations)
}

export function createSelectionShapePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: selectionShapeKey,
    state: {
      init: (_config, state) => selectionBlockDecorations(state.doc, state.selection),
      apply: (tr, previous, oldState, newState) => {
        if (!tr.docChanged && !tr.selectionSet) {
          return previous
        }
        // Typing with a caret stays on the cheap path: empty before, empty after.
        if (!isTextRange(newState.selection) && !isTextRange(oldState.selection)) {
          return previous
        }
        return selectionBlockDecorations(newState.doc, newState.selection)
      },
    },
    props: {
      decorations: (state) => selectionShapeKey.getState(state) ?? DecorationSet.empty,
    },
  })
}

/** Mounts the selection shape inside an editor (a `NoteEditor` child). */
export function SelectionShape(): null {
  useExtension(useMemo(() => definePlugin(createSelectionShapePlugin()), []))
  return null
}
