import { locateTaskMarker, TaskStaleError } from './edit'
import { parseNote } from './extract'
import { splitFrontmatter } from './frontmatter'
import { parseBody } from './grammar'
import { documentLineEnding } from './line-endings'
import type { TaskMarker } from './model'

/**
 * Moving a task between notes (the Tasks view's "Move to project", Todoist's
 * `m`): cut the task's list item — its line plus every line nested under it,
 * so subtasks travel with their parent — then paste it into the target note,
 * at the end of a section or of the note. The task line itself is carried
 * byte for byte (date, time, priority, repeat, links), only re-indented to
 * the target's top level. Pure string transforms; the caller persists.
 */

/** The item a {@link cutTaskBlock} removed: its lines, dedented to column 0. */
export interface TaskBlock {
  readonly lines: readonly string[]
}

function listItemEnd(source: string, offset: number): number {
  const { body, bodyOffset } = splitFrontmatter(source)
  let node = parseBody(body).resolve(offset - bodyOffset, 1)
  while (node.name !== 'ListItem' && node.parent !== null) {
    node = node.parent
  }
  return node.name === 'ListItem' ? node.to + bodyOffset : offset
}

/**
 * Remove the task at `task` together with the items nested under it.
 * Throws {@link TaskStaleError} when the indexed line no longer matches.
 */
export function cutTaskBlock(
  source: string,
  task: TaskMarker,
): { source: string; block: TaskBlock } {
  const offset = locateTaskMarker(source, task.markerOffset, task.raw)
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1
  const itemEnd = listItemEnd(source, offset)
  const newline = source.indexOf('\n', Math.max(itemEnd - 1, offset))
  const blockEnd = newline === -1 ? source.length : newline + 1
  const text = source.slice(lineStart, blockEnd).replace(/\r?\n$/, '')
  const rawLines = text.split(/\r?\n/)
  const indent = /^[ \t]*/.exec(rawLines[0]!)![0].length
  const lines = rawLines
    .map((line) => (line.slice(0, indent).trim() === '' ? line.slice(indent) : line.trimStart()))
    .filter((line, index) => index === 0 || line.trim() !== '')
  return { source: source.slice(0, lineStart) + source.slice(blockEnd), block: { lines } }
}

/**
 * The sections a note's tasks can be moved under: its top-level headings of
 * level 2 or deeper, in document order (the same rule as a task's `section`).
 */
export function taskSectionNames(source: string): string[] {
  const names: string[] = []
  for (const heading of parseNote({ path: '', source }).headings) {
    if (
      heading.topLevel &&
      heading.level >= 2 &&
      heading.text !== '' &&
      !names.includes(heading.text)
    ) {
      names.push(heading.text)
    }
  }
  return names
}

/**
 * Paste a cut task block into `source`: after the last line of `section` (its
 * first top-level heading with that text, up to the next heading of the same
 * or a higher level), or at the end of the note when `section` is null. A
 * section the note no longer has is added as a new `##` heading at the end.
 */
export function pasteTaskBlock(source: string, block: TaskBlock, section: string | null): string {
  if (block.lines.length === 0) {
    throw new TaskStaleError('nothing to paste')
  }
  const lineEnding = documentLineEnding(source)
  const text = block.lines.join(lineEnding)
  const headings = parseNote({ path: '', source }).headings.filter((heading) => heading.topLevel)
  if (section === null) {
    const base = source.replace(/\s*$/, '')
    return `${base.length > 0 ? `${base}${lineEnding}` : ''}${text}${lineEnding}`
  }
  const target = headings.find((heading) => heading.level >= 2 && heading.text === section)
  if (target === undefined) {
    const base = source.replace(/\s*$/, '')
    const prefix = base.length > 0 ? `${base}${lineEnding.repeat(2)}` : ''
    return `${prefix}## ${section}${lineEnding}${lineEnding}${text}${lineEnding}`
  }
  const next = headings.find(
    (heading) => heading.from > target.from && heading.level <= target.level,
  )
  const sectionEnd = next?.from ?? source.length
  const sectionText = source.slice(0, sectionEnd).replace(/\s*$/, '')
  const rest = source.slice(sectionEnd)
  const separator = next === undefined ? '' : lineEnding
  return `${sectionText}${lineEnding}${text}${lineEnding}${separator}${rest}`
}
