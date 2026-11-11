import { docToMarkdown } from '@meowdown/core'
import type { EditorState } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'
import { errorMessage, getBacklinks, planBranchMove, type SourceBacklink } from '@kore/core'
import { commitNoteBodyTransform } from '@/lib/note-frontmatter'
import { startOperation } from '@/lib/operations'
import { clearZoom } from './block-zoom-plugin'
import { targetAt, targetSpan } from './block-zoom-target'

/**
 * Move a branch to another note (Plan 33 C2): the block zoom would show at the
 * caret (a list item with its children, a heading with its section, any other
 * block alone) leaves this note and lands at the end of the picked one, and
 * `[[Note#^id]]` links to its lines follow it. The text policy is core's
 * `planBranchMove`; this file reads the editor and writes the notes.
 */

export interface Branch {
  readonly from: number
  readonly to: number
  /** The branch as Markdown, the way it lands in the other note. */
  readonly markdown: string
}

/** The branch at `pos` (a block start, as the block menu passes it), else at the caret. */
export function branchAt(state: EditorState, pos?: number): Branch | null {
  const { doc } = state
  if (pos !== undefined && (pos < 0 || pos >= doc.content.size)) {
    return null
  }
  const $pos = pos === undefined ? state.selection.$from : doc.resolve(pos + 1)
  const target = targetAt(doc, $pos)
  const span = target === null ? null : targetSpan(doc, target)
  if (span === null) {
    return null
  }
  const slice = doc.slice(span.from, span.to)
  const markdown = docToMarkdown(state.schema.topNodeType.create(null, slice.content)).trim()
  return markdown === '' ? null : { ...span, markdown }
}

export interface MoveDestination {
  readonly path: string
  /** How a link names it (its title's link form, or a daily's date). */
  readonly target: string
  readonly title: string
}

export interface MoveBranchRequest {
  readonly view: EditorView
  /** The note the branch leaves. */
  readonly notePath: string
  /** How a link names that note. */
  readonly sourceTarget: string
  readonly destination: MoveDestination
  readonly generation: number
  /** The block menu's block; the caret's when absent. */
  readonly pos?: number | undefined
  /** Opens the destination, for the confirmation's "Open". */
  readonly open?: (() => void) | undefined
}

/**
 * Run the move. The branch leaves the editor first (one undoable step) so a
 * write that fails can put it back; the destination is then appended, and
 * every note whose links named a moved line is updated. Reports through the
 * operations status line; resolves to whether the branch moved.
 */
export async function moveBranch(request: MoveBranchRequest): Promise<boolean> {
  const { view, notePath, destination, generation } = request
  const refuse = (why: string): false => {
    startOperation(`Moving to ${destination.title}`).fail(why)
    return false
  }
  if (destination.path === notePath) {
    return refuse('That is the note it is already in.')
  }
  const picked = branchAt(view.state, request.pos)
  if (picked === null) {
    return refuse('There is nothing to move here.')
  }
  let backlinks: readonly SourceBacklink[]
  try {
    backlinks = await getBacklinks(notePath)
  } catch (cause) {
    return refuse(errorMessage(cause))
  }
  // The await let the user type: move only the branch they picked.
  const branch = branchAt(view.state, request.pos)
  if (view.isDestroyed || branch === null || branch.markdown !== picked.markdown) {
    return refuse('The note changed while moving. Try again.')
  }
  const move = planBranchMove({
    branch: branch.markdown,
    sourcePath: notePath,
    sourceTarget: request.sourceTarget,
    destinationPath: destination.path,
    destinationTarget: destination.target,
    backlinks,
  })

  const removed = view.state.doc.slice(branch.from, branch.to)
  view.dispatch(clearZoom(view.state.tr.delete(branch.from, branch.to)).scrollIntoView())
  const afterDelete = view.state.doc
  try {
    await commitNoteBodyTransform(destination.path, move.landIn, generation)
  } catch (cause) {
    // Nothing landed: put the branch back if the note is as the move left it.
    if (!view.isDestroyed && view.state.doc === afterDelete) {
      view.dispatch(view.state.tr.replace(branch.from, branch.from, removed))
    }
    return refuse(errorMessage(cause))
  }

  // The links that follow the moved lines; each note is its own write.
  const writes =
    move.movedIds.length === 0
      ? []
      : [
          commitNoteBodyTransform(notePath, move.leaveFrom, generation),
          ...move.linkingNotes.map((path) =>
            commitNoteBodyTransform(path, move.follow, generation),
          ),
        ]
  const failed = (await Promise.allSettled(writes)).flatMap((result) =>
    result.status === 'rejected' ? [errorMessage(result.reason)] : [],
  )
  const done = startOperation(
    `Moved to ${destination.title}`,
    request.open === undefined ? {} : { action: { label: 'Open', run: request.open } },
  )
  if (failed.length > 0) {
    done.warn(`Some links to its lines were not updated: ${failed.join('; ')}`)
  } else {
    done.done()
  }
  return true
}
