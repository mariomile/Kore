import { lineAuthorKey, type LineAuthor } from '@kore/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, type Transaction } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'

/**
 * Who wrote what (Plan 33, A3): each block of the note shaded by who last
 * changed it, from the vault's backup history. Agent blocks carry the
 * agent's mark (a tinted bar and wash, its name on hover); the host's get a
 * neutral one; yours, and lines not committed yet, stay plain so the shading
 * points at what someone else wrote.
 *
 * Meowdown keeps inline Markdown literal in each textblock (`**bold**`,
 * `[[link]]`), so a block's text lines are found verbatim in the body's
 * Markdown lines, in document order. A block takes the newest author among
 * its lines. Nothing is written to the file.
 */

/** What the host blamed: the body it sent, with one author per body line. */
export interface LineAuthorsInput {
  readonly body: string
  /** `authors[i]` names body line `i`. */
  readonly authors: readonly LineAuthor[]
}

interface LineAuthorsState {
  readonly decorations: DecorationSet
}

const lineAuthorsKey = new PluginKey<LineAuthorsState>('kore-line-authors')

const TABLE_CELL_ROLES = new Set(['cell', 'header_cell'])

/**
 * The body line indices each textblock's text sits on, by the textblock's
 * position. Lines are matched in order, so a repeated line resolves to the
 * next occurrence after the previous block; table cells share their row's
 * line. A block whose text cannot be found is left out.
 */
export function textblockLines(doc: ProseMirrorNode, body: string): Map<number, number[]> {
  const lines = body.split('\n')
  const found = new Map<number, number[]>()
  let cursor = 0
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) {
      return true
    }
    const indices: number[] = []
    let from = cursor
    for (const part of node.textContent.split('\n')) {
      if (part.trim() === '') {
        continue
      }
      let index = from
      while (index < lines.length && !lines[index]!.includes(part)) {
        index += 1
      }
      if (index < lines.length) {
        indices.push(index)
        from = index + 1
      }
    }
    if (indices.length > 0) {
      found.set(pos, indices)
      const inCell = TABLE_CELL_ROLES.has(String(parent?.type.spec['tableRole'] ?? ''))
      cursor = inCell ? indices[0]! : indices.at(-1)! + 1
    }
    return false
  })
  return found
}

function newest(authors: readonly LineAuthor[]): LineAuthor | null {
  let best: Exclude<LineAuthor, { kind: 'unsaved' }> | null = null
  for (const author of authors) {
    if (author.kind === 'unsaved') {
      return author
    }
    if (best === null || author.timeMs > best.timeMs) {
      best = author
    }
  }
  return best
}

/** A hue per agent name, stable across sessions. */
export function agentHue(name: string): number {
  let hash = 0
  for (const char of name.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash % 360
}

function authorLabel(author: LineAuthor): string | null {
  if (author.kind === 'unsaved' || author.kind === 'owner') {
    return null
  }
  const when = new Date(author.timeMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return author.kind === 'agent'
    ? `Written by ${author.name}, ${when}`
    : `Written by Kore host, ${when}`
}

/** The node decorations for `input` over `doc`: one per agent or host block. */
export function lineAuthorDecorations(
  doc: ProseMirrorNode,
  input: LineAuthorsInput,
): DecorationSet {
  const decorations: Decoration[] = []
  for (const [pos, indices] of textblockLines(doc, input.body)) {
    const author = newest(indices.flatMap((index) => input.authors[index] ?? []))
    const label = author === null ? null : authorLabel(author)
    if (author === null || label === null) {
      continue
    }
    const node = doc.nodeAt(pos)
    if (node === null) {
      continue
    }
    const attrs: Record<string, string> = {
      class: 'kore-line-author',
      'data-line-author': author.kind,
      'data-line-author-key': lineAuthorKey(author),
      title: label,
    }
    if (author.kind === 'agent') {
      attrs['style'] = `--kore-line-author-hue: ${agentHue(author.name)}`
    }
    decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs))
  }
  return DecorationSet.create(doc, decorations)
}

function readInput(tr: Transaction): LineAuthorsInput | null | undefined {
  const meta: unknown = tr.getMeta(lineAuthorsKey)
  if (meta === undefined) {
    return undefined
  }
  return meta as LineAuthorsInput | null
}

/**
 * Fired on the editor's DOM once the plugin is part of the view: the host's
 * first blame waits for it, since an answer has nowhere to land before.
 */
export const LINE_AUTHORS_READY = 'kore-line-authors-ready'
/** Fired on the editor's DOM after each document change, so the host can blame again. */
export const LINE_AUTHORS_DOC_CHANGED = 'kore-line-authors-doc-changed'

export function createLineAuthorsPlugin(): Plugin<LineAuthorsState> {
  return new Plugin<LineAuthorsState>({
    key: lineAuthorsKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply: (tr, previous) => {
        const input = readInput(tr)
        if (input !== undefined) {
          return {
            decorations:
              input === null ? DecorationSet.empty : lineAuthorDecorations(tr.doc, input),
          }
        }
        return tr.docChanged
          ? { decorations: previous.decorations.map(tr.mapping, tr.doc) }
          : previous
      },
    },
    view: (view) => {
      // Not from inside view construction: the host dispatches in answer.
      queueMicrotask(() => view.dom.dispatchEvent(new Event(LINE_AUTHORS_READY)))
      return {
        update: (current, previous) => {
          if (!current.state.doc.eq(previous.doc)) {
            current.dom.dispatchEvent(new Event(LINE_AUTHORS_DOC_CHANGED))
          }
        },
      }
    },
    props: {
      decorations: (state) => lineAuthorsKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  })
}

/** Show `input` (or clear the shading with `null`). A torn-down view is skipped. */
export function setLineAuthors(view: EditorView, input: LineAuthorsInput | null): void {
  if (view.isDestroyed || lineAuthorsKey.getState(view.state) === undefined) {
    return
  }
  view.dispatch(view.state.tr.setMeta(lineAuthorsKey, input).setMeta('addToHistory', false))
}
