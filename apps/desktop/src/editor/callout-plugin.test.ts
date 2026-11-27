import { Schema, type Node as ProseMirrorNode } from '@prosekit/pm/model'
import { EditorState, TextSelection, type Transaction } from '@prosekit/pm/state'
import type { Decoration, DecorationSet } from '@prosekit/pm/view'
import { describe, expect, it } from 'vitest'
import { createCalloutPlugin } from './callout-plugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    list: { group: 'block', content: 'block+' },
    text: {},
  },
})

function p(text: string): ProseMirrorNode {
  return schema.node('paragraph', null, text === '' ? [] : [schema.text(text)])
}
function quote(...blocks: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node('blockquote', null, blocks)
}
const list = (...blocks: ProseMirrorNode[]): ProseMirrorNode => schema.node('list', null, blocks)

function startDoc(): ProseMirrorNode {
  return schema.node('doc', null, [
    p('intro'),
    quote(p('[!faq]- Why fold?\nBecause.')),
    p('between'),
    list(p('item'), quote(p('[!tip] Nested tip'), p('body'))),
    quote(p('[!my-type]'), p('Plain')),
    p('plain quote follows'),
    quote(p('not a callout')),
    p('end'),
  ])
}

/** Every decoration as comparable data: range, kind, attrs, and widget key. */
function describeSet(set: DecorationSet, doc: ProseMirrorNode): string[] {
  return set
    .find(0, doc.content.size)
    .map((decoration: Decoration) => {
      const inner = decoration as unknown as {
        type: { attrs?: Record<string, string>; spec?: { key?: string; side?: number } }
      }
      const kind = decoration.from === decoration.to ? 'widget' : 'range'
      return JSON.stringify([
        decoration.from,
        decoration.to,
        kind,
        inner.type.attrs ?? null,
        inner.type.spec?.key ?? null,
        inner.type.spec?.side ?? null,
      ])
    })
    .sort()
}

function decorationsOf(state: EditorState): DecorationSet {
  const plugin = state.plugins[0]!
  return plugin.props.decorations!.call(plugin, state) as DecorationSet
}

/** The same document and selection drawn from scratch, with the same fold and focus state. */
function freshState(state: EditorState): EditorState {
  const plugin = state.plugins[0]!
  const previous = plugin.getState(state) as { toggled: readonly number[]; focused: boolean }
  let fresh = EditorState.create({
    doc: state.doc,
    selection: state.selection,
    plugins: [createCalloutPlugin()],
  })
  const freshPlugin = fresh.plugins[0]!
  if (previous.focused) {
    fresh = fresh.apply(fresh.tr.setMeta(freshPlugin.spec.key!, { focused: true }))
  }
  for (const pos of previous.toggled) {
    fresh = fresh.apply(fresh.tr.setMeta(freshPlugin.spec.key!, { toggle: pos }))
  }
  return fresh
}

/** A seeded pseudo-random source, so a failure replays. */
function random(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}

function randomEdit(state: EditorState, next: () => number): Transaction {
  const size = state.doc.content.size
  const at = (): number => {
    const $pos = state.doc.resolve(Math.floor(next() * size))
    return $pos.parent.isTextblock ? $pos.pos : TextSelection.near($pos).from
  }
  const roll = next()
  const tr = state.tr
  if (roll < 0.35) {
    const pos = at()
    tr.insertText(['x', '[!note] ', '\n', '-', '!'][Math.floor(next() * 5)]!, pos)
  } else if (roll < 0.55) {
    const from = at()
    const to = Math.min(from + 1 + Math.floor(next() * 4), state.doc.resolve(from).end())
    if (to > from) {
      tr.delete(from, to)
    }
  } else if (roll < 0.65) {
    const pos = at()
    tr.split(pos)
  } else {
    tr.setSelection(TextSelection.create(state.doc, at()))
  }
  return tr
}

describe('callout plugin incremental redraw', () => {
  it('matches a full redraw after every edit, caret move, fold and focus change', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed)
      let state = EditorState.create({ doc: startDoc(), plugins: [createCalloutPlugin()] })
      const key = state.plugins[0]!.spec.key!
      state = state.apply(state.tr.setMeta(key, { focused: true }))
      for (let step = 0; step < 60; step++) {
        const roll = next()
        let tr: Transaction
        if (roll < 0.05) {
          tr = state.tr.setMeta(key, { focused: next() < 0.5 })
        } else if (roll < 0.1) {
          const quotes: number[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'blockquote') {
              quotes.push(pos)
            }
          })
          tr =
            quotes.length > 0
              ? state.tr.setMeta(key, { toggle: quotes[Math.floor(next() * quotes.length)] })
              : state.tr
        } else {
          tr = randomEdit(state, next)
        }
        state = state.apply(tr)
        expect(describeSet(decorationsOf(state), state.doc), `seed ${seed} step ${step}`).toEqual(
          describeSet(decorationsOf(freshState(state)), state.doc),
        )
      }
    }
  })
})
