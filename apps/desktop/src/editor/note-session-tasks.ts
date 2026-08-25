import {
  appendBlock,
  editTaskLine,
  nextOccurrenceAppends,
  removeTaskLine,
  taskLineToBullet,
  toggleTaskMarker,
  type TaskMarker,
} from '@reflect/core'
import { todayIso } from '@/lib/dates'

/** The session's transactional body-edit primitive (see note-session-state.ts). */
export type CommitBodyEdit = (transform: (full: string) => string) => Promise<boolean>

/** The out-of-editor task/append commits a note session exposes. */
export interface NoteSessionTaskCommits {
  commitTaskToggle: (task: TaskMarker) => Promise<boolean>
  commitTaskEdit: (task: TaskMarker, content: string) => Promise<boolean>
  commitTaskRemove: (task: TaskMarker) => Promise<boolean>
  commitTaskToBullet: (task: TaskMarker) => Promise<boolean>
  commitBodyAppend: (block: string) => Promise<boolean>
}

/**
 * The task-line commits, each a thin transform over `commitBodyEdit` (the
 * Tasks view's toggle / edit / delete / to-bullet, and the append shared with
 * the suggested-contact card and repeat spawning).
 */
export function createTaskCommits(commitBodyEdit: CommitBodyEdit): NoteSessionTaskCommits {
  function commitTaskToggle(task: TaskMarker): Promise<boolean> {
    return commitBodyEdit((full) => toggleTaskMarker(full, task).source)
  }

  function commitTaskEdit(task: TaskMarker, content: string): Promise<boolean> {
    return commitBodyEdit((full) => editTaskLine(full, task, content))
  }

  function commitTaskRemove(task: TaskMarker): Promise<boolean> {
    return commitBodyEdit((full) => removeTaskLine(full, task))
  }

  function commitTaskToBullet(task: TaskMarker): Promise<boolean> {
    return commitBodyEdit((full) => taskLineToBullet(full, task))
  }

  function commitBodyAppend(block: string): Promise<boolean> {
    if (block.trim() === '') {
      return Promise.resolve(false)
    }
    return commitBodyEdit((full) => appendBlock(full, block))
  }

  return {
    commitTaskToggle,
    commitTaskEdit,
    commitTaskRemove,
    commitTaskToBullet,
    commitBodyAppend,
  }
}

/**
 * Completing a `@repeat` task by clicking the in-editor checkbox never goes
 * through `toggleTask` — meowdown only reports the markdown change. Diff the
 * pre/post buffers for checkbox-only completions and append the next
 * occurrence. Best-effort: the completion is already in the buffer.
 */
export function createRepeatSpawner(
  commitBodyAppend: (block: string) => Promise<boolean>,
): (previousMarkdown: string, nextMarkdown: string) => void {
  /**
   * Serializes editor-checkbox repeat spawns. Two overlapping `editorChanged`
   * completions must not each `commitBodyEdit` against the same pre-append
   * buffer and clobber the other occurrence.
   */
  let spawnChain: Promise<void> = Promise.resolve()

  return (previousMarkdown: string, nextMarkdown: string): void => {
    const lines = nextOccurrenceAppends(previousMarkdown, nextMarkdown, todayIso())
    if (lines.length === 0) {
      return
    }
    const run = async (): Promise<void> => {
      try {
        for (const line of lines) {
          await commitBodyAppend(line)
        }
      } catch {
        // Best-effort: the completion stands; the next occurrence just isn't
        // written. Matches Tasks-view spawn in note-task.ts.
      }
    }
    spawnChain = spawnChain.then(run, run)
  }
}
