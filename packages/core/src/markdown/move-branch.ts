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

/** One indexed link to the source note (the shape of a backlinks row). */
export interface SourceBacklink {
  readonly sourcePath: string | null
  /** The raw target, fragment and label included (`Daily#^a1b2|label`). */
  readonly targetRaw: string | null
}

export interface BranchMoveInput {
  /** The moved branch's Markdown, as it leaves the source note. */
  readonly branch: string
  readonly sourcePath: string
  /** How a link names the source note (`[[Daily]]`). */
  readonly sourceTarget: string
  readonly destinationPath: string
  /** How a link names the picked note. */
  readonly destinationTarget: string
  /** Every indexed link to the source note. */
  readonly backlinks: readonly SourceBacklink[]
}

/**
 * Every note edit a move makes, as text transforms over each note's current
 * Markdown. A link to a moved line ends up naming the destination wherever it
 * sits: written same-note (`[[#^id]]`) or as `[[Source#^id]]`, in the two
 * notes or in any other note.
 */
export interface BranchMove {
  /** The ids the branch carries. */
  readonly movedIds: readonly string[]
  /**
   * The picked note with the branch appended. Inside the branch, a same-note
   * link to a line that stayed behind now names the source.
   */
  landIn(destination: string): string
  /** The source note, already without the branch. */
  leaveFrom(source: string): string
  /** Other notes whose links name a moved line, to pass through {@link follow}. */
  readonly linkingNotes: readonly string[]
  follow(markdown: string): string
}

export function planBranchMove(input: BranchMoveInput): BranchMove {
  const movedIds = blockIdsIn(input.branch)
  const moved = new Set(movedIds)
  const pointsAtSource = sourceLinkMatcher(
    input.sourceTarget,
    input.backlinks.flatMap((link) => (link.targetRaw === null ? [] : [link.targetRaw])),
  )
  const toMoved = (note: string, id: string): boolean =>
    moved.has(id) && (note === '' || pointsAtSource(note))
  // `''` writes a same-note link.
  const retargetMoved = (markdown: string, to: string): string =>
    retargetBlockLinks(markdown, (note, id) => (toMoved(note, id) ? to : null))
  const branch = retargetBlockLinks(input.branch, (note, id) => {
    if (note === '' && !moved.has(id)) {
      return input.sourceTarget
    }
    return toMoved(note, id) ? '' : null
  })
  const linkingNotes = new Set(
    input.backlinks.flatMap((link) => {
      const id = link.targetRaw === null ? null : noteLinkBlockId(link.targetRaw)
      return link.sourcePath !== null && id !== null && moved.has(id) ? [link.sourcePath] : []
    }),
  )
  linkingNotes.delete(input.sourcePath)
  linkingNotes.delete(input.destinationPath)
  return {
    movedIds,
    landIn: (destination) => appendBlock(retargetMoved(destination, ''), branch),
    leaveFrom: (source) => retargetMoved(source, input.destinationTarget),
    linkingNotes: [...linkingNotes],
    // Another note's same-note links are its own lines, never the source's.
    follow: (markdown) =>
      retargetBlockLinks(markdown, (note, id) =>
        note !== '' && toMoved(note, id) ? input.destinationTarget : null,
      ),
  }
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
 * links name it (`sourceTarget`) or the way any indexed backlink to it does.
 */
function sourceLinkMatcher(
  sourceTarget: string,
  backlinkTargets: readonly string[],
): (note: string) => boolean {
  const keys = new Set<string>()
  for (const target of [sourceTarget, ...backlinkTargets]) {
    const key = noteKey(noteOf(target))
    if (key !== null) {
      keys.add(key)
    }
  }
  return (note) => {
    const key = noteKey(note)
    return key !== null && keys.has(key)
  }
}
