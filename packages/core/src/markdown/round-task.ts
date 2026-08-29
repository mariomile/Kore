import type { SyntaxNode } from '@meowdown/markdown'

/**
 * Task-list bullets. Every GFM checkbox in a bullet list is a task the Tasks
 * view projects — a note's checklist belongs on the Tasks page wherever it was
 * written. The *round* `+` bullet is Reflect's own task syntax and stays what
 * the app writes for new tasks; `-`/`*` checkboxes are the same task written
 * in ordinary markdown (by hand, by paste, by another editor). The two still
 * render differently in the editor (round vs square), but both project.
 */

/** The bullet character the app writes for its own (round) tasks. */
export const ROUND_TASK_BULLET = '+'

/**
 * The list bullet enclosing `task` — a Lezer `Task` node parsed from `body` —
 * or `null` when the checkbox isn't a bullet-list item (GFM also allows
 * checkboxes in ordered lists; those stay plain markdown).
 *
 * The answer is read from the enclosing list item's own `ListMark`, not from
 * the characters preceding the checkbox on the line. Anything the parser puts
 * between the line start and the bullet — a blockquote's `>`, and with it every
 * callout, which Kore renders from a blockquote — belongs to the container, not
 * to the list marker. Matching the line prefix classified `> + [ ] pay rent`
 * by its container and dropped it from the Tasks projection; reading the mark
 * keeps a task a task wherever it is nested.
 */
export function taskListBullet(body: string, task: SyntaxNode): string | null {
  const item = task.parent
  if (item?.name !== 'ListItem' || item.parent?.name !== 'BulletList') {
    return null
  }
  const mark = item.firstChild
  if (mark?.name !== 'ListMark') {
    return null
  }
  return body.slice(mark.from, mark.to)
}

/** Is `task` a *round* (`+`-bulleted) task? Drives the editor's round visuals. */
export function isRoundTaskNode(body: string, task: SyntaxNode): boolean {
  return taskListBullet(body, task) === ROUND_TASK_BULLET
}
