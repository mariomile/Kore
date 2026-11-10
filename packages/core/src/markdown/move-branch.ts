import { wikiNoteReference } from '../graph/note-reference'
import { appendBlock } from './append-section'
import { blockIdsIn, noteLinkBlockId } from './block-ids'
import { parseNote } from './extract'

/**
 * Moving a branch to another note (Plan 33 C2): the branch lands at the end
 * of the picked note, nothing stays behind, and every `[[Note#^id]]` that
 * pointed at a line in the branch follows it. Pure text policy; the editor
 * gathers the notes and writes them.
 */

/** The note half of a link target: `Plan` in `Plan#^a1b2|label`. */
function noteOf(target: string): string {
  const link = target.split('|')[0] ?? ''
  const hash = link.lastIndexOf('#')
  return (hash === -1 ? link : link.slice(0, hash)).trim()
}

/**
 * `markdown` with each `[[note#^id]]` (or embed) rewritten where `retarget`
 * returns a new note half for it: `''` makes a same-note `[[#^id]]`, null
 * leaves the link alone. The id and any `|label` stay as they are, and links
 * inside code are never touched.
 */
export function retargetBlockLinks(
  markdown: string,
  retarget: (note: string, id: string) => string | null,
): string {
  const links = parseNote({ path: 'move.md', source: markdown }).wikiLinks
  let next = markdown
  // Right to left, so earlier spans keep their offsets.
  for (const link of [...links].sort((a, b) => b.from - a.from)) {
    const id = noteLinkBlockId(link.target)
    const raw = next.slice(link.from, link.to)
    if (id === null || !raw.startsWith('[[') || !raw.endsWith(']]')) {
      continue
    }
    const inner = raw.slice(2, -2)
    const note = retarget(noteOf(inner), id)
    if (note === null) {
      continue
    }
    const hash = inner.split('|')[0]!.lastIndexOf('#')
    next = `${next.slice(0, link.from)}[[${note}${inner.slice(hash)}]]${next.slice(link.to)}`
  }
  return next
}

export interface BranchMove {
  /** The moved branch's Markdown, as it leaves the source note. */
  readonly branch: string
  /** The source note without the branch. */
  readonly remaining: string
  /** The picked note before the move. */
  readonly destination: string
  /** How a link names the source note (`[[Daily]]`). */
  readonly sourceTarget: string
  /** How a link names the picked note. */
  readonly destinationTarget: string
  /** Whether a link's note half names the source note (title, alias or path). */
  readonly pointsAtSource: (note: string) => boolean
}

export interface BranchMoveResult {
  /** The source note to write: same-note links to moved lines now name the destination. */
  readonly source: string
  /** The picked note to write, with the branch appended at its end. */
  readonly destination: string
  /** The ids the branch carried: links to them elsewhere must follow ({@link followMovedIds}). */
  readonly movedIds: readonly string[]
}

/**
 * The two notes after a move. A link to a moved line names the destination
 * wherever it sits in the two notes, written as a same-note `[[#^id]]` or as
 * `[[Source#^id]]`. Inside the branch, a same-note link to a line that stayed
 * behind now names the source.
 */
export function planBranchMove(move: BranchMove): BranchMoveResult {
  const movedIds = blockIdsIn(move.branch)
  const moved = new Set(movedIds)
  const toMoved = (note: string, id: string): boolean =>
    moved.has(id) && (note === '' || move.pointsAtSource(note))
  const branch = retargetBlockLinks(move.branch, (note, id) => {
    if (note === '' && !moved.has(id)) {
      return move.sourceTarget
    }
    return note !== '' && toMoved(note, id) ? '' : null
  })
  const source = retargetBlockLinks(move.remaining, (note, id) =>
    toMoved(note, id) ? move.destinationTarget : null,
  )
  const destination = followMovedIds(move.destination, movedIds, move.pointsAtSource, '')
  return { source, destination: appendBlock(destination, branch), movedIds }
}

/**
 * Another note's links after the move: each one that `pointsAtSource` says
 * names the source note, and whose id moved, now names the destination.
 */
export function followMovedIds(
  markdown: string,
  movedIds: readonly string[],
  pointsAtSource: (note: string) => boolean,
  destinationTarget: string,
): string {
  const moved = new Set(movedIds)
  return retargetBlockLinks(markdown, (note, id) =>
    note !== '' && moved.has(id) && pointsAtSource(note) ? destinationTarget : null,
  )
}

/** The note a link's note half names, as a comparable key; null when it names none. */
function noteKey(note: string): string | null {
  const reference = wikiNoteReference(note)
  if (reference === null || reference.kind === 'self') {
    return null
  }
  return reference.kind === 'path' ? `path:${reference.path}` : `key:${reference.key}`
}

/**
 * Whether a link's note half names the source note: the way the source's own
 * links name it (`sourceTarget`) or the way any indexed backlink to it does
 * (`backlinkTargets`, the raw targets, fragments and labels included).
 */
export function sourceLinkMatcher(
  sourceTarget: string,
  backlinkTargets: readonly string[],
): (note: string) => boolean {
  const keys = new Set<string>()
  for (const target of [sourceTarget, ...backlinkTargets]) {
    const link = target.split('|')[0] ?? ''
    const hash = link.lastIndexOf('#')
    const key = noteKey(hash === -1 ? link : link.slice(0, hash))
    if (key !== null) {
      keys.add(key)
    }
  }
  return (note) => {
    const key = noteKey(note)
    return key !== null && keys.has(key)
  }
}
