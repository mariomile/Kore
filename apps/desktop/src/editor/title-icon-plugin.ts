import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey } from '@prosekit/pm/state'
import { Decoration, DecorationSet } from '@prosekit/pm/view'

/**
 * A slot at the start of the note's title — its first top-level `#` heading —
 * where the note icon draws inline, left of the title text. The plugin only
 * places `mount` (an element the host owns and renders into) as a widget
 * decoration; the markdown is never touched. `onTitle` reports whether the
 * slot is placed, so the host can draw the icon elsewhere when the note has
 * no `#` title.
 */
export interface TitleIconOptions {
  readonly mount: HTMLElement
  readonly onTitle: (hasTitle: boolean) => void
}

const titleIconKey = new PluginKey<DecorationSet>('kore-title-icon')

/** Document position just inside the first top-level H1, or null. */
export function titleHeadingStart(doc: ProseMirrorNode): number | null {
  let start: number | null = null
  doc.forEach((child, offset) => {
    if (start === null && child.type.name === 'heading' && child.attrs['level'] === 1) {
      start = offset + 1
    }
  })
  return start
}

function decorate(doc: ProseMirrorNode, mount: HTMLElement): DecorationSet {
  const start = titleHeadingStart(doc)
  if (start === null) {
    return DecorationSet.empty
  }
  return DecorationSet.create(doc, [
    Decoration.widget(start, () => mount, {
      // The same key keeps the same DOM across edits, so the icon (and an
      // open picker anchored to it) survives typing in the title.
      key: 'kore-title-icon',
      side: -1,
      ignoreSelection: true,
      // Clicks inside the slot open the picker; the editor must not move the
      // caret or start a selection for them.
      stopEvent: () => true,
    }),
  ])
}

/** The plugin behind {@link TitleIconOptions}. */
export function createTitleIconPlugin({ mount, onTitle }: TitleIconOptions): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: titleIconKey,
    state: {
      init: (_config, state) => decorate(state.doc, mount),
      apply: (tr, previous) => (tr.docChanged ? decorate(tr.doc, mount) : previous),
    },
    props: {
      decorations: (state) => titleIconKey.getState(state),
    },
    view: (view) => {
      let hasTitle = titleHeadingStart(view.state.doc) !== null
      onTitle(hasTitle)
      return {
        update: (updated) => {
          const next = titleHeadingStart(updated.state.doc) !== null
          if (next !== hasTitle) {
            hasTitle = next
            onTitle(next)
          }
        },
        destroy: () => onTitle(false),
      }
    },
  })
}
