import { useMemo, type ReactElement } from 'react'
import { parseCollectionEmbedBody } from '@reflect/core'
import { definePlugin } from '@prosekit/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection } from '@prosekit/pm/state'
import { useExtension } from '@meowdown/react'

const guardKey = new PluginKey('reflect-collection-fence-guard')

/** A code block that the live Collection widget renders in place of its source. */
function isRenderedCollectionFence(node: ProseMirrorNode): boolean {
  return (
    node.type.name === 'codeBlock' &&
    node.attrs['language'] === 'collection' &&
    parseCollectionEmbedBody(node.textContent) !== null
  )
}

/**
 * The caret must never sit inside a rendered collection fence: its source
 * is hidden, so text edits there would be invisible. Move the selection past
 * the fence in the direction it was travelling, and select the fence as a
 * block when there is no text on that side.
 */
function createGuardPlugin(): Plugin {
  return new Plugin({
    key: guardKey,
    appendTransaction(_transactions, oldState, newState) {
      const { selection } = newState
      if (selection instanceof NodeSelection) {
        return null
      }
      const { $anchor } = selection
      if ($anchor.depth === 0 || !isRenderedCollectionFence($anchor.parent)) {
        return null
      }
      const fenceStart = $anchor.before()
      const fenceEnd = $anchor.after()
      const forward = newState.selection.anchor >= oldState.selection.anchor
      const escaped = forward
        ? Selection.findFrom(newState.doc.resolve(fenceEnd), 1, true)
        : Selection.findFrom(newState.doc.resolve(fenceStart), -1, true)
      const next = escaped ?? NodeSelection.create(newState.doc, fenceStart)
      return newState.tr.setSelection(next)
    },
  })
}

/**
 * Keeps the caret out of rendered collection fences. Mounted as a NoteEditor
 * child next to the `renderCodeBlock` that draws the widget.
 */
export function CollectionFenceGuard(): ReactElement | null {
  useExtension(useMemo(() => definePlugin(createGuardPlugin()), []))
  return null
}
