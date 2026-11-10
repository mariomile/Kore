import { docToMarkdown } from '@meowdown/core'
import type { EditorState } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'
import {
  errorMessage,
  followMovedIds,
  getBacklinks,
  noteLinkBlockId,
  planBranchMove,
  sourceLinkMatcher,
} from '@reflect/core'
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
  const { view, notePath, sourceTarget, destination, generation } = request
  const label = `Moving to ${destination.title}`
  if (destination.path === notePath) {
    startOperation(label).fail('That is the note it is already in.')
    return false
  }
  const branch = branchAt(view.state, request.pos)
  if (branch === null) {
    startOperation(label).fail('There is nothing to move here.')
    return false
  }
  let backlinks: { sourcePath: string | null; targetRaw: string | null }[]
  try {
    backlinks = await getBacklinks(notePath)
  } catch (cause) {
    startOperation(label).fail(errorMessage(cause))
    return false
  }
  // The await let the user type: move only the branch they picked.
  const now = branchAt(view.state, request.pos)
  if (view.isDestroyed || now === null || now.markdown !== branch.markdown) {
    startOperation(label).fail('The note changed while moving. Try again.')
    return false
  }
  const pointsAtSource = sourceLinkMatcher(
    sourceTarget,
    backlinks.flatMap((link) => (link.targetRaw === null ? [] : [link.targetRaw])),
  )
  const plan = (remaining: string, into: string): ReturnType<typeof planBranchMove> =>
    planBranchMove({
      branch: now.markdown,
      remaining,
      destination: into,
      sourceTarget,
      destinationTarget: destination.target,
      pointsAtSource,
    })
  const { movedIds } = plan('', '')

  const removed = view.state.doc.slice(now.from, now.to)
  view.dispatch(clearZoom(view.state.tr.delete(now.from, now.to)).scrollIntoView())
  const afterDelete = view.state.doc

  const operation = startOperation(label)
  try {
    await commitNoteBodyTransform(
      destination.path,
      (into) => plan('', into).destination,
      generation,
    )
  } catch (cause) {
    // Nothing landed: put the branch back if the note is as the move left it.
    if (!view.isDestroyed && view.state.doc === afterDelete) {
      view.dispatch(view.state.tr.replace(now.from, now.from, removed))
    }
    operation.fail(errorMessage(cause))
    return false
  }

  const failed: string[] = []
  // Same-note links in this note to the lines that left.
  if (movedIds.length > 0) {
    try {
      await commitNoteBodyTransform(notePath, (source) => plan(source, '').source, generation)
    } catch (cause) {
      failed.push(errorMessage(cause))
    }
    const moved = new Set(movedIds)
    const linking = new Set(
      backlinks.flatMap((link) => {
        const id = link.targetRaw === null ? null : noteLinkBlockId(link.targetRaw)
        return link.sourcePath !== null && id !== null && moved.has(id) ? [link.sourcePath] : []
      }),
    )
    linking.delete(notePath)
    linking.delete(destination.path)
    for (const path of linking) {
      try {
        await commitNoteBodyTransform(
          path,
          (source) => followMovedIds(source, movedIds, pointsAtSource, destination.target),
          generation,
        )
      } catch (cause) {
        failed.push(`${path}: ${errorMessage(cause)}`)
      }
    }
  }
  const done = startOperation(
    `Moved to ${destination.title}`,
    request.open === undefined ? {} : { action: { label: 'Open', run: request.open } },
  )
  operation.dismiss()
  if (failed.length > 0) {
    done.warn(`Some links to its lines were not updated: ${failed.join('; ')}`)
  } else {
    done.done()
  }
  return true
}
