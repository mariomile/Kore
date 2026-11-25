import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'

/**
 * A paragraph drawn as something richer (a vault video, a pasted iframe):
 * the widget sits in front of the paragraph, and the paragraph, still the
 * file's only content, hides until the caret is on it, then shows under the
 * widget to edit or delete. Link cards and callout markers follow the same
 * reveal-on-caret rule.
 */
export interface BlockWidgetSpec<T> {
  /** Names the plugin (and its state) for debugging. */
  readonly name: string
  /** What a paragraph draws as, or null for an ordinary paragraph. */
  readonly match: (paragraph: ProseMirrorNode) => T | null
  /**
   * Identity of what a paragraph draws: the same identity keeps the same DOM
   * through edits elsewhere, so a playing video plays on. Copies of one
   * thing are told apart by their order.
   */
  readonly identity: (value: T) => string
  /** The widget's DOM, built once per identity. */
  readonly render: (value: T, view: EditorView) => HTMLElement
  /** Class of the paragraph under a widget; `is-editing` joins it on caret. */
  readonly sourceClass: string
}

interface BlockWidgetState {
  readonly decorations: DecorationSet
  readonly focused: boolean
}

export function createBlockWidgetPlugin<T>(spec: BlockWidgetSpec<T>): Plugin<BlockWidgetState> {
  const key = new PluginKey<BlockWidgetState>(spec.name)

  const build = (state: EditorState, focused: boolean): DecorationSet => {
    const { doc, selection } = state
    const decorations: Decoration[] = []
    const seen = new Map<string, number>()
    doc.descendants((node, pos) => {
      if (!node.isTextblock) {
        return true
      }
      const value = spec.match(node)
      if (value === null) {
        return false
      }
      const identity = spec.identity(value)
      const copy = seen.get(identity) ?? 0
      seen.set(identity, copy + 1)
      const end = pos + node.nodeSize
      const onLine = focused && selection.from <= end - 1 && selection.to >= pos + 1
      decorations.push(
        Decoration.widget(pos, (view) => spec.render(value, view), {
          side: -1,
          ignoreSelection: true,
          stopEvent: () => true,
          key: `${spec.name}:${copy}:${identity}`,
        }),
        Decoration.node(pos, end, {
          class: onLine ? `${spec.sourceClass} is-editing` : spec.sourceClass,
        }),
      )
      return false
    })
    return DecorationSet.create(doc, decorations)
  }

  const readFocused = (tr: Transaction): boolean | null => {
    const meta: unknown = tr.getMeta(key)
    return typeof meta === 'boolean' ? meta : null
  }

  const setFocused = (view: EditorView, focused: boolean): boolean => {
    if (key.getState(view.state)?.focused !== focused) {
      view.dispatch(view.state.tr.setMeta(key, focused))
    }
    return false
  }

  return new Plugin<BlockWidgetState>({
    key,
    state: {
      init: (_config, state) => ({ decorations: build(state, false), focused: false }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = readFocused(tr)
        if (!tr.docChanged && !tr.selectionSet && meta === null) {
          return previous
        }
        const focused = meta ?? previous.focused
        return { decorations: build(newState, focused), focused }
      },
    },
    view: (view) => {
      // Mounted into an editor that already has focus: no focus event will
      // tell us.
      if (view.hasFocus()) {
        queueMicrotask(() => {
          if (!view.isDestroyed) setFocused(view, view.hasFocus())
        })
      }
      return {}
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty,
      handleDOMEvents: {
        focus: (view) => setFocused(view, true),
        blur: (view) => setFocused(view, false),
      },
    },
  })
}
