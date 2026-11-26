import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'

/**
 * An agent's lines, live: the blocks an outside agent just wrote into this
 * note get the accent wash, and the last one carries the agent's flag (its
 * name with a caret while it writes, then its name and Undo). Nothing is
 * written to the file; the input comes from the app's agent presence.
 */
export interface AgentLiveMark {
  readonly agent: string
  /** The body lines the agent added, as Markdown. */
  readonly lines: readonly string[]
  readonly writing: boolean
  readonly onUndo: (() => void) | null
}

const agentLiveKey = new PluginKey<readonly AgentLiveMark[]>('kore-agent-live')

/** A textblock shorter than this never matches, so stray words stay plain. */
const MIN_MATCH_LENGTH = 3

function flagDom(mark: AgentLiveMark): HTMLElement {
  const flag = document.createElement('span')
  flag.className = 'kore-agent-flag'
  flag.dataset['writing'] = mark.writing ? 'true' : 'false'
  flag.contentEditable = 'false'
  const name = document.createElement('span')
  name.className = 'kore-agent-flag-name'
  name.textContent = mark.agent
  flag.append(name)
  if (!mark.writing && mark.onUndo !== null) {
    const undo = document.createElement('button')
    undo.type = 'button'
    undo.className = 'kore-agent-flag-undo'
    undo.textContent = 'Undo'
    const onUndo = mark.onUndo
    undo.addEventListener('mousedown', (event) => event.preventDefault())
    undo.addEventListener('click', (event) => {
      event.preventDefault()
      onUndo()
    })
    flag.append(undo)
  }
  return flag
}

export function agentLiveDecorations(
  doc: ProseMirrorNode,
  marks: readonly AgentLiveMark[],
): DecorationSet {
  const decorations: Decoration[] = []
  for (const mark of marks) {
    let last: { pos: number; node: ProseMirrorNode } | null = null
    doc.descendants((node, pos) => {
      if (!node.isTextblock) {
        return true
      }
      const text = node.textContent.trim()
      if (text.length >= MIN_MATCH_LENGTH && mark.lines.some((line) => line.includes(text))) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'kore-agent-live',
            title: `Written by ${mark.agent}`,
          }),
        )
        last = { pos, node }
      }
      return false
    })
    if (last !== null) {
      const { pos, node } = last as { pos: number; node: ProseMirrorNode }
      decorations.push(
        Decoration.widget(pos + node.nodeSize - 1, () => flagDom(mark), {
          side: 1,
          ignoreSelection: true,
          key: `agent-flag-${mark.agent}-${mark.writing ? 'w' : 'd'}`,
        }),
      )
    }
  }
  return DecorationSet.create(doc, decorations)
}

export function createAgentLivePlugin(): Plugin<readonly AgentLiveMark[]> {
  let cache: {
    doc: ProseMirrorNode
    marks: readonly AgentLiveMark[]
    set: DecorationSet
  } | null = null
  return new Plugin<readonly AgentLiveMark[]>({
    key: agentLiveKey,
    state: {
      init: () => [],
      apply: (tr, previous) => {
        const next: unknown = tr.getMeta(agentLiveKey)
        return next === undefined ? previous : (next as readonly AgentLiveMark[])
      },
    },
    props: {
      // Matched against the current text on every render of the state, so a
      // write that lands after the marks (the editor reloads the file) is
      // shaded without another round trip. Free when no agent wrote here.
      decorations: (state) => {
        const marks = agentLiveKey.getState(state) ?? []
        if (marks.length === 0) {
          return DecorationSet.empty
        }
        if (cache?.doc !== state.doc || cache.marks !== marks) {
          cache = { doc: state.doc, marks, set: agentLiveDecorations(state.doc, marks) }
        }
        return cache.set
      },
    },
  })
}

export function setAgentLiveMarks(view: EditorView, marks: readonly AgentLiveMark[]): void {
  if (view.isDestroyed || agentLiveKey.getState(view.state) === undefined) {
    return
  }
  view.dispatch(view.state.tr.setMeta(agentLiveKey, marks).setMeta('addToHistory', false))
}
