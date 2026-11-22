import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { isIsoDate } from '@kore/utils'
import { memoByNode } from './node-memo'

/**
 * Dates typed as plain text (`2026-11-16`, the shape agents write) draw as
 * the same chip a `[[2026-11-16]]` link does. The markdown keeps the text:
 * the chip is a widget decoration and the date's characters are hidden
 * behind it until the caret touches them, the reveal-on-caret rule link
 * cards and callout markers use. A click on the chip puts the caret after
 * the date, revealing it to edit.
 */

/** Marks a plain date may carry and still read as a date, not as code or a link. */
const PLAIN_MARKS = new Set(['mdStrong', 'mdEm', 'mdDel', 'mdHighlight'])

/**
 * A free-standing `YYYY-MM-DD`: not part of a longer token such as a
 * timestamp (`2026-11-16T09:00`), a version, a path or a file name.
 */
const BARE_DATE = /(?<![\w./:@#-])\d{4}-\d{2}-\d{2}(?![\w/:@-]|\.\d)/g

/** Where a plain date sits, as offsets into a text. */
export interface DateRange {
  readonly start: number
  readonly end: number
  readonly date: string
}

/** Every free-standing calendar date in `text`. */
export function bareDateRanges(text: string): DateRange[] {
  const found: DateRange[] = []
  for (const match of text.matchAll(BARE_DATE)) {
    if (isIsoDate(match[0])) {
      found.push({ start: match.index, end: match.index + match[0].length, date: match[0] })
    }
  }
  return found
}

/** The plain dates of one textblock, as offsets into its content. */
const textblockDates = memoByNode((block: ProseMirrorNode): readonly DateRange[] => {
  if (block.type.spec.code === true) {
    return []
  }
  const found: DateRange[] = []
  block.forEach((child, offset) => {
    if (!child.isText || !child.marks.every((mark) => PLAIN_MARKS.has(mark.type.name))) {
      return
    }
    for (const range of bareDateRanges(child.text ?? '')) {
      found.push({ start: offset + range.start, end: offset + range.end, date: range.date })
    }
  })
  return found
})

/** A chip in front of each plain date of `block`, and its characters hidden behind it. */
function blockDecorations(
  block: ProseMirrorNode,
  pos: number,
  label: (date: string) => string,
): Decoration[] {
  const decorations: Decoration[] = []
  for (const range of textblockDates(block)) {
    const start = pos + 1 + range.start
    const end = pos + 1 + range.end
    const text = label(range.date)
    decorations.push(
      Decoration.widget(start, chipWidget(range.date, text, end - start), {
        side: -1,
        ignoreSelection: true,
        key: `date-chip:${range.date}:${text}`,
      }),
      Decoration.inline(start, end, { class: 'kore-date-source' }),
    )
  }
  return decorations
}

/** `chips` with every textblock between `from` and `to` drawn afresh. */
function redrawBlocks(
  chips: DecorationSet,
  doc: ProseMirrorNode,
  from: number,
  to: number,
  label: (date: string) => string,
): DecorationSet {
  let redrawn = chips
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) {
      return true
    }
    redrawn = redrawn.remove(redrawn.find(pos, pos + node.nodeSize))
    redrawn = redrawn.add(doc, blockDecorations(node, pos, label))
    return false
  })
  return redrawn
}

/**
 * The stretch of the new document `tr` changed, found by comparing the two
 * documents rather than reading the steps: Meowdown sets its inline marks
 * with a step of its own whose map is empty. Unchanged nodes are shared, so
 * the comparison skips them by identity.
 */
function changedRange(tr: Transaction): [number, number] | null {
  const start = tr.doc.content.findDiffStart(tr.before.content)
  if (start === null) {
    return null
  }
  const end = tr.doc.content.findDiffEnd(tr.before.content)?.a ?? start
  return [start, Math.max(start, end)]
}

/**
 * The previous chips carried through `tr`, with the textblocks it changed
 * drawn again: a keystroke rescans one block, not the note.
 */
function updatedChips(
  previous: DecorationSet,
  tr: Transaction,
  label: (date: string) => string,
): DecorationSet {
  const chips = previous.map(tr.mapping, tr.doc)
  const range = changedRange(tr)
  return range === null
    ? chips
    : redrawBlocks(
        chips,
        tr.doc,
        Math.max(0, range[0] - 1),
        Math.min(tr.doc.content.size, range[1] + 1),
        label,
      )
}

/** Every plain date's chip, as if the caret touched none of them. */
const dateChipKey = new PluginKey<DecorationSet>('kore-date-chips')

function dateChipElement(date: string, label: string): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'kore-date-chip'
  chip.contentEditable = 'false'
  chip.dataset['date'] = date
  chip.textContent = label
  return chip
}

function chipWidget(date: string, label: string, length: number) {
  return (view: EditorView, getPos: () => number | undefined): HTMLElement => {
    const chip = dateChipElement(date, label)
    chip.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const start = getPos()
      if (start === undefined) {
        return
      }
      view.focus()
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, start + length)),
      )
    })
    return chip
  }
}

/** The chips minus those of the dates the selection touches, which show as text. */
function visibleChips(chips: DecorationSet, state: EditorState): DecorationSet {
  const { from, to } = state.selection
  const touched = chips.find(from, to)
  if (touched.length === 0) {
    return chips
  }
  const start = Math.min(...touched.map((decoration) => decoration.from))
  const end = Math.max(...touched.map((decoration) => decoration.to))
  return chips.remove(chips.find(start, end))
}

/**
 * The ProseMirror plugin behind `DateChips`; `label` turns a `YYYY-MM-DD`
 * into the chip's text (the user's date format).
 */
export function createDateChipPlugin(label: (date: string) => string): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: dateChipKey,
    state: {
      init: (_config, { doc }) =>
        redrawBlocks(DecorationSet.empty, doc, 0, doc.content.size, label),
      apply: (tr, previous) => (tr.docChanged ? updatedChips(previous, tr, label) : previous),
    },
    props: {
      decorations: (state) => {
        const chips = dateChipKey.getState(state)
        return chips === undefined ? DecorationSet.empty : visibleChips(chips, state)
      },
    },
  })
}
