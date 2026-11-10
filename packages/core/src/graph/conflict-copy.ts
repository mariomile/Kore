import { createNoteIfAbsent } from './commands'

const MAX_COPY_ATTEMPTS = 50

/**
 * `notes/Idea.md` → `notes/Idea (conflict).md`, then `(conflict 2)`, … — the
 * same naming the git sync uses for its binary conflict copies
 * (`conflict_copy_path` in `src-tauri/src/git/merge.rs`). Splits on the
 * basename only, so a dot in a folder name never moves the copy elsewhere.
 */
export function conflictCopyPath(path: string, ordinal = 1): string {
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash + 1)
  const file = path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, '']
  const label = ordinal === 1 ? 'conflict' : `conflict ${ordinal}`
  return `${dir}${stem} (${label})${ext}`
}

/**
 * Write `contents` beside `path` as a new conflict copy, never overwriting an
 * existing file (an earlier copy keeps its text). Returns the copy's path.
 */
export async function saveConflictCopy(
  path: string,
  contents: string,
  generation: number,
): Promise<string> {
  for (let ordinal = 1; ordinal <= MAX_COPY_ATTEMPTS; ordinal += 1) {
    const copy = conflictCopyPath(path, ordinal)
    const outcome = await createNoteIfAbsent(copy, contents, generation)
    if (outcome.kind === 'created') {
      return copy
    }
  }
  throw new Error(`no free conflict copy name next to "${path}"`)
}
