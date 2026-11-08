import { z } from 'zod'
import { call } from '../ipc/invoke'
import { AGENT_TRAILER } from './agent-commits'

/**
 * The vault's activity log (Plan 33, A1): the backup repository's commits,
 * grouped into sittings (one author's run of work) with each author named:
 * an agent (its `Kore-Agent` trailer), the always-on host, or the owner.
 */

const activityFileSchema = z.object({
  path: z.string(),
  kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
  oldPath: z.string().optional(),
})
export type ActivityFile = z.infer<typeof activityFileSchema>

const activityCommitSchema = z.object({
  commit: z.string(),
  timeMs: z.number(),
  authorName: z.string(),
  authorEmail: z.string(),
  summary: z.string(),
  trailers: z.array(z.object({ key: z.string(), value: z.string() })),
  files: z.array(activityFileSchema),
})
export type ActivityCommit = z.infer<typeof activityCommitSchema>

const activityPageSchema = z.object({
  commits: z.array(activityCommitSchema),
  next: z.string().nullable(),
})
export type ActivityPage = z.infer<typeof activityPageSchema>

/** One page of the commit log, newest first; `after` is a previous page's `next`. */
export async function gitActivity(
  after: string | null,
  limit: number,
  generation: number,
): Promise<ActivityPage> {
  return await call('git_activity', { after, limit, generation }, activityPageSchema)
}

/** Who made a change. */
export type ActivityAuthor =
  | { readonly kind: 'agent'; readonly name: string }
  | { readonly kind: 'host'; readonly name: string }
  | { readonly kind: 'owner'; readonly name: string }

/** The name the `kore` CLI's always-on host commits under. */
const HOST_AUTHOR = 'Kore host'

/** Name a commit's author: the agent trailer wins, then the host, else the owner. */
export function activityAuthor(commit: ActivityCommit): ActivityAuthor {
  const agent = commit.trailers.find((trailer) => trailer.key === AGENT_TRAILER)?.value.trim()
  if (agent !== undefined && agent.length > 0) {
    return { kind: 'agent', name: agent }
  }
  if (commit.authorName === HOST_AUTHOR) {
    return { kind: 'host', name: HOST_AUTHOR }
  }
  return { kind: 'owner', name: commit.authorName }
}

/** Stable key: one owner, one host, one key per agent name. */
export function activityAuthorKey(author: ActivityAuthor): string {
  return author.kind === 'agent' ? `agent:${author.name.toLowerCase()}` : author.kind
}

/** A note a sitting touched, with its net change across the sitting. */
export interface SittingNote {
  readonly path: string
  readonly kind: ActivityFile['kind']
  /** The newest commit in the sitting that touched the note. */
  readonly commit: string
}

/** One author's run of consecutive commits. */
export interface ActivitySitting {
  /** The newest commit's id: stable while older pages load. */
  readonly id: string
  readonly author: ActivityAuthor
  readonly startMs: number
  readonly endMs: number
  /** Commit ids, newest first. */
  readonly commits: readonly string[]
  readonly notes: readonly SittingNote[]
}

/** Commits further apart than this start a new sitting. */
export const SITTING_GAP_MS = 30 * 60 * 1000

/**
 * Group commits (newest first, as the log returns them) into sittings:
 * consecutive commits by the same author with no gap over `gapMs`. A note
 * keeps the kind of its oldest change in the sitting when that change
 * created it (an added-then-edited note reads as added), else its newest.
 */
export function groupSittings(
  commits: readonly ActivityCommit[],
  gapMs: number = SITTING_GAP_MS,
): ActivitySitting[] {
  return runsOf(commits, gapMs).map(toSitting)
}

/** Split the log into runs: same author, each commit within `gapMs` of the next. */
function runsOf(commits: readonly ActivityCommit[], gapMs: number): ActivityCommit[][] {
  const runs: ActivityCommit[][] = []
  for (const commit of commits) {
    const run = runs.at(-1)
    const previous = run?.at(-1)
    const joins =
      previous !== undefined &&
      activityAuthorKey(activityAuthor(previous)) === activityAuthorKey(activityAuthor(commit)) &&
      previous.timeMs - commit.timeMs <= gapMs
    if (joins) {
      run!.push(commit)
    } else {
      runs.push([commit])
    }
  }
  return runs
}

/** One run as a sitting: commits newest first, each note once. */
function toSitting(run: readonly ActivityCommit[]): ActivitySitting {
  const newest = run[0]!
  const notes = new Map<string, SittingNote>()
  for (const commit of run) {
    for (const file of commit.files) {
      const seen = notes.get(file.path)
      if (seen === undefined) {
        notes.set(file.path, { path: file.path, kind: file.kind, commit: commit.commit })
      } else if (file.kind === 'added' && seen.kind !== 'deleted') {
        notes.set(file.path, { ...seen, kind: 'added' })
      }
    }
  }
  return {
    id: newest.commit,
    author: activityAuthor(newest),
    startMs: run.at(-1)!.timeMs,
    endMs: newest.timeMs,
    commits: run.map((commit) => commit.commit),
    notes: [...notes.values()],
  }
}
