import {
  cutTaskBlock,
  isAppError,
  pasteTaskBlock,
  readNote,
  TaskStaleError,
  taskSectionNames,
  writeNote,
  type TaskBlock,
  type TaskMarker,
} from '@reflect/core'
import { openSession } from '@/editor/open-documents'
import { NoteBusyError, serializeByPath, type TaskRef } from '@/lib/note-task'

/** Where a moved task lands: a project note and, optionally, one of its sections. */
export interface TaskMoveTarget {
  readonly notePath: string
  /** A heading of the target note, or null for the end of the note. */
  readonly section: string | null
}

/** One note's content just before and just after a move rewrote it. */
export interface NoteRewrite {
  readonly path: string
  readonly before: string
  readonly after: string
}

/** A finished move: the rewrites it made, in the order it made them. */
export interface TaskMove {
  readonly rewrites: readonly NoteRewrite[]
}

/**
 * Rewrite one note, the way every Tasks-view write routes: through the open
 * note's live session (so unsaved edits survive), else on disk. A missing
 * note starts empty. Serialized per path with the other task writes, and the
 * exact before/after strings come back so the move can be undone.
 */
function rewriteNote(
  path: string,
  transform: (source: string) => string,
  generation: number,
): Promise<NoteRewrite> {
  return serializeByPath(path, async () => {
    const owner = openSession(path)
    if (owner !== null) {
      let captured: { before: string; after: string } | null = null
      const done = await owner.commitBodyTransform((full) => {
        const after = transform(full)
        captured = { before: full, after }
        return after
      })
      if (!done || captured === null) {
        throw new NoteBusyError('This note can’t be updated right now — try again in a moment.')
      }
      const { before, after } = captured as { before: string; after: string }
      return { path, before, after }
    }
    let before: string
    try {
      before = await readNote(path)
    } catch (cause) {
      if (isAppError(cause) && cause.kind === 'notFound') {
        before = ''
      } else {
        throw cause
      }
    }
    const after = transform(before)
    await writeNote(path, after, generation)
    return { path, before, after }
  })
}

/** Put a note back as it was before `rewrite`, refusing if it changed since. */
function restoreNote(rewrite: NoteRewrite, generation: number): Promise<NoteRewrite> {
  return rewriteNote(
    rewrite.path,
    (current) => {
      if (current !== rewrite.after) {
        throw new TaskStaleError('The note changed after the move, so it can’t be undone.')
      }
      return rewrite.before
    },
    generation,
  )
}

/**
 * Move a task, with the items nested under it, to `target` (Todoist's "Move
 * to project"). The source note loses the block before the target gains it;
 * if the paste fails, the source is put back, so a task is never lost or
 * doubled. The core transforms ({@link cutTaskBlock}, {@link pasteTaskBlock})
 * carry the line verbatim, so date, priority and repeat travel with it.
 */
export async function moveTask(
  task: TaskRef,
  target: TaskMoveTarget,
  generation: number,
): Promise<TaskMove> {
  const marker: TaskMarker = { markerOffset: task.markerOffset, raw: task.raw }
  if (task.notePath === target.notePath) {
    const rewrite = await rewriteNote(
      task.notePath,
      (source) => {
        const cut = cutTaskBlock(source, marker)
        return pasteTaskBlock(cut.source, cut.block, target.section)
      },
      generation,
    )
    return { rewrites: [rewrite] }
  }
  let block: TaskBlock | null = null
  const removed = await rewriteNote(
    task.notePath,
    (source) => {
      const cut = cutTaskBlock(source, marker)
      block = cut.block
      return cut.source
    },
    generation,
  )
  try {
    const added = await rewriteNote(
      target.notePath,
      (source) => pasteTaskBlock(source, block!, target.section),
      generation,
    )
    return { rewrites: [removed, added] }
  } catch (cause) {
    await restoreNote(removed, generation).catch(() => {})
    throw cause
  }
}

/**
 * Undo moves, newest first: each note goes back to its pre-move content, as
 * long as nothing edited it since (else {@link TaskStaleError}, nothing lost).
 */
export async function undoTaskMoves(moves: readonly TaskMove[], generation: number): Promise<void> {
  for (const move of [...moves].reverse()) {
    for (const rewrite of [...move.rewrites].reverse()) {
      await restoreNote(rewrite, generation)
    }
  }
}

/**
 * The sections a project offers as move targets: its headings, read from disk
 * when the picker opens on it. A note that can't be read offers none, so the
 * move still lands at the end of the note.
 */
export async function projectSections(path: string): Promise<string[]> {
  try {
    return taskSectionNames(await readNote(path))
  } catch {
    return []
  }
}
