import type { SyntaxNode } from '@meowdown/markdown'

/**
 * Reflect's task syntax is the *round* checkbox — a GFM checkbox in a `+`
 * bullet list (`+ [ ] text`). Square checklist items (`-`/`*`) stay plain
 * markdown and are deliberately not projected into Tasks (Plan 18).
 */

/** The bullet character that makes a GFM checkbox a Reflect task. */
export const ROUND_TASK_BULLET = '+'

/**
 * Is `task` — a Lezer `Task` node parsed from `body` — a Reflect task?
 *
 * The answer is read from the enclosing list item's own `ListMark`, not from
 * the characters preceding the checkbox on the line. Anything the parser puts
 * between the line start and the bullet — a blockquote's `>`, and with it every
 * callout, which Kore renders from a blockquote — belongs to the container, not
 * to the list marker. Matching the line prefix classified `> + [ ] pay rent` as
 * a square checklist item and dropped it from the Tasks projection; reading the
 * mark keeps a task a task wherever it is nested.
 */
export function isRoundTaskNode(body: string, task: SyntaxNode): boolean {
  const item = task.parent
  if (item?.name !== 'ListItem' || item.parent?.name !== 'BulletList') {
    return false
  }
  const mark = item.firstChild
  if (mark?.name !== 'ListMark') {
    return false
  }
  return body.slice(mark.from, mark.to) === ROUND_TASK_BULLET
}
