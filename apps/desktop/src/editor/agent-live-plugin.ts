import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { agentAvatarElement } from '@/components/agent-presence/agent-avatar'

/**
 * An agent's lines, live. Lines that just arrived write themselves in (the
 * `kore-agent-ink` motion: they resolve from a blur in the accent and settle
 * into the page's ink), and the agent's avatar rides at the end of its last
 * line: with a caret and a turning ring while it writes, then still, opening
 * onto Undo on hover or tap. No bars, no washes: once the ink dries, the
 * text is the user's page again and only the small avatar says who wrote it.
 * Nothing is written to the file.
 */
export interface AgentLiveMark {
  readonly agent: string
  /** Every body line the agent added here this sitting, as Markdown. */
  readonly lines: readonly string[]
  /** The lines that arrived just now, which play the ink motion once. */
  readonly freshLines: readonly string[]
  readonly writing: boolean
  readonly onUndo: (() => void) | null
}

const agentLiveKey = new PluginKey<readonly AgentLiveMark[]>('kore-agent-live')

/** A textblock shorter than this never matches, so stray words stay plain. */
const MIN_MATCH_LENGTH = 3

function matches(text: string, lines: readonly string[]): boolean {
  return text.length >= MIN_MATCH_LENGTH && lines.some((line) => line.includes(text))
}

function markDom(mark: AgentLiveMark): HTMLElement {
  const root = document.createElement('span')
  root.className = 'kore-agent-mark'
  root.dataset['writing'] = mark.writing ? 'true' : 'false'
  root.contentEditable = 'false'
  if (mark.writing) {
    const caret = document.createElement('span')
    caret.className = 'kore-agent-caret'
    caret.setAttribute('aria-hidden', 'true')
    root.append(caret)
  }
  const avatar = agentAvatarElement(mark.agent, 'xs', mark.writing)
  if (mark.writing || mark.onUndo === null) {
    root.title = mark.writing ? `${mark.agent} is writing` : `Written by ${mark.agent}`
    root.append(avatar)
    return root
  }
  // Settled: the avatar is a quiet handle that opens onto who wrote this and
  // Undo. Focusable so a tap (iPhone) or Tab opens it like hover does.
  root.tabIndex = 0
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', `Written by ${mark.agent}`)
  const drawer = document.createElement('span')
  drawer.className = 'kore-agent-mark-drawer'
  const inner = document.createElement('span')
  inner.className = 'kore-agent-mark-drawer-inner'
  const name = document.createElement('span')
  name.className = 'kore-agent-mark-name'
  name.textContent = mark.agent
  const undo = document.createElement('button')
  undo.type = 'button'
  undo.className = 'kore-agent-mark-undo'
  undo.textContent = 'Undo'
  const onUndo = mark.onUndo
  undo.addEventListener('mousedown', (event) => event.preventDefault())
  undo.addEventListener('click', (event) => {
    event.preventDefault()
    onUndo()
  })
  inner.append(name, undo)
  drawer.append(inner)
  root.append(avatar, drawer)
  return root
}

export function agentLiveDecorations(
  doc: ProseMirrorNode,
  marks: readonly AgentLiveMark[],
): DecorationSet {
  const decorations: Decoration[] = []
  for (const mark of marks) {
    let last: { pos: number; size: number } | null = null
    doc.descendants((node, pos) => {
      if (!node.isTextblock) {
        return true
      }
      const text = node.textContent.trim()
      if (matches(text, mark.lines)) {
        if (matches(text, mark.freshLines)) {
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kore-agent-ink' }))
        }
        last = { pos, size: node.nodeSize }
      }
      return false
    })
    if (last !== null) {
      const { pos, size } = last as { pos: number; size: number }
      decorations.push(
        Decoration.widget(pos + size - 1, () => markDom(mark), {
          side: 1,
          ignoreSelection: true,
          key: `agent-mark-${mark.agent}-${mark.writing ? 'writing' : 'settled'}`,
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
      // Matched against the current text, so a write that lands after its
      // marks (the editor reloads the file) is found without another round
      // trip; cached per document and marks, free when no agent wrote here.
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
