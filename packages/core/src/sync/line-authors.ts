import { z } from 'zod'
import { call } from '../ipc/invoke'
import { activityAuthor, activityAuthorKey, type ActivityAuthor } from './activity'

/**
 * Who wrote what in a note (Plan 33, A3): each line's last author, from
 * `git blame` over the backup history A1 signs per agent. Lines the backup
 * hasn't committed yet are `unsaved`: whoever typed them, no commit names
 * them, so nothing is guessed.
 */

const blameSchema = z.object({
  hunks: z.array(
    z.object({
      startLine: z.number().int().positive(),
      lines: z.number().int().nonnegative(),
      commit: z.string().nullable(),
    }),
  ),
  commits: z.record(
    z.string(),
    z.object({
      timeMs: z.number(),
      authorName: z.string(),
      authorEmail: z.string(),
      trailers: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  ),
})
export type NoteBlame = z.infer<typeof blameSchema>

/**
 * Blame `content` (the note as it is shown) against the note's committed
 * history. Rejects when the vault has no backup repository.
 */
export async function gitBlame(
  path: string,
  content: string,
  generation: number,
): Promise<NoteBlame> {
  return await call('git_blame', { path, content, generation }, blameSchema)
}

/** One line's author: a named author with the commit's time, or not committed yet. */
export type LineAuthor =
  | (ActivityAuthor & { readonly timeMs: number })
  | { readonly kind: 'unsaved' }

/**
 * Each line's author, index 0 for line 1, `lineCount` entries. A line no
 * hunk covers (the blame ran on different text) is `unsaved`.
 */
export function lineAuthors(blame: NoteBlame, lineCount: number): LineAuthor[] {
  const unsaved: LineAuthor = { kind: 'unsaved' }
  const authors: LineAuthor[] = Array.from({ length: lineCount }, () => unsaved)
  const named = new Map<string, LineAuthor>()
  for (const hunk of blame.hunks) {
    if (hunk.commit === null) {
      continue
    }
    let author = named.get(hunk.commit)
    if (author === undefined) {
      const commit = blame.commits[hunk.commit]
      if (commit === undefined) {
        continue
      }
      author = { ...activityAuthor(commit), timeMs: commit.timeMs }
      named.set(hunk.commit, author)
    }
    const end = Math.min(lineCount, hunk.startLine - 1 + hunk.lines)
    for (let index = hunk.startLine - 1; index < end; index += 1) {
      authors[index] = author
    }
  }
  return authors
}

/** Stable key for shading: one per agent name, one for the host, owner and unsaved. */
export function lineAuthorKey(author: LineAuthor): string {
  return author.kind === 'unsaved' ? 'unsaved' : activityAuthorKey(author)
}
