import { z } from 'zod'
import { foldTag } from '../markdown'

/**
 * Agent routines (automations): scheduled background runs of an agent over
 * the vault — "every morning, prepare my daily brief"; "every Sunday, curate
 * the shared memory". Definitions live in the settings document; the desktop
 * runner executes a due routine headless through the agent CLI providers in
 * edit mode, so a routine can actually do work (write notes, keep memory
 * current) and records itself in the shared journal like any other session.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** When a routine fires: a clock time, or a collection row event. */
export const collectionEventKindSchema = z.enum(['row-created', 'row-updated'])
export type CollectionEventKind = z.infer<typeof collectionEventKindSchema>

export const routineScheduleSchema = z.union([
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME_RE) }),
  z.object({
    kind: z.literal('weekly'),
    /** 0 = Sunday … 6 = Saturday (JS `Date#getDay`). */
    weekday: z.number().int().min(0).max(6),
    time: z.string().regex(TIME_RE),
  }),
  z.object({
    kind: z.literal('event'),
    event: collectionEventKindSchema,
    tag: z.string().min(1),
  }),
])
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>
export type ClockSchedule = Extract<RoutineSchedule, { kind: 'daily' | 'weekly' }>
export type EventSchedule = Extract<RoutineSchedule, { kind: 'event' }>

/** Clock schedules (daily/weekly). Event schedules have no `time`. */
export function isClockSchedule(schedule: RoutineSchedule): schedule is ClockSchedule {
  return schedule.kind === 'daily' || schedule.kind === 'weekly'
}

/** Collection-row event schedules. They never fire from the clock. */
export function isEventSchedule(schedule: RoutineSchedule): schedule is EventSchedule {
  return schedule.kind === 'event'
}

/** One completed run attempt, as kept in the routine's history. */
export const routineRunSchema = z.object({
  /** Epoch ms when the run started. */
  startedMs: z.number(),
  /** 'skipped' = a script-mode silent tick: the script saw nothing to do. */
  status: z.enum(['ok', 'error', 'skipped']),
  /** The failure message when status is 'error'. */
  error: z.string().nullable().catch(null),
  /** Notes the run touched (its activity ledger). */
  changedPaths: z.array(z.string()).catch([]),
})
export type RoutineRun = z.infer<typeof routineRunSchema>

/**
 * History cap per routine. Runs live in the settings document, so the list
 * must stay small; twenty covers weeks of a daily routine.
 */
export const ROUTINE_RUN_HISTORY_LIMIT = 20

/** Failures in a row before a routine pauses itself instead of retrying. */
export const ROUTINE_MAX_CONSECUTIVE_FAILURES = 3

/** Base delay before the first failure retry; each further failure doubles it. */
export const ROUTINE_RETRY_BASE_MS = 30_000

/**
 * Delay before the next attempt after `consecutiveFailures` failures in a
 * row: 30s, then 60s. The third failure pauses the routine instead (see
 * ROUTINE_MAX_CONSECUTIVE_FAILURES), so the sequence never grows past that.
 */
export function routineRetryDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1)
  return ROUTINE_RETRY_BASE_MS * 2 ** exponent
}

/**
 * The strike-counter change one failed run produces: either a scheduled
 * retry (backoff from `nowMs`) or, on the third consecutive failure, a
 * pause — the caller flips `enabled` off so the routine stops firing until
 * the user re-enables it (which resets the counter).
 */
export function routineFailureUpdate(
  previousFailures: number,
  nowMs: number,
): { consecutiveFailures: number; retryAtMs: number | null; paused: boolean } {
  const consecutiveFailures = previousFailures + 1
  const paused = consecutiveFailures >= ROUTINE_MAX_CONSECUTIVE_FAILURES
  return {
    consecutiveFailures,
    retryAtMs: paused ? null : nowMs + routineRetryDelayMs(consecutiveFailures),
    paused,
  }
}

/** The history with `run` prepended (newest first), capped. */
export function appendRoutineRun(runs: RoutineRun[], run: RoutineRun): RoutineRun[] {
  return [run, ...runs].slice(0, ROUTINE_RUN_HISTORY_LIMIT)
}

/** What the ledger says for a run the process died under (TDR 0007). */
export const INTERRUPTED_ROUTINE_RUN_ERROR =
  'The app quit while this run was in flight; the run did not complete.'

/**
 * The history entry recovery records when the previous process left an
 * in-flight marker: the run started but never settled. It counts as a
 * failure on purpose — the work did not happen, so the normal backoff (and
 * pause after three in a row) applies.
 */
export function interruptedRoutineRun(startedMs: number): RoutineRun {
  return {
    startedMs,
    status: 'error',
    error: INTERRUPTED_ROUTINE_RUN_ERROR,
    changedPaths: [],
  }
}

/**
 * What the ledger says for a run the user stopped mid-flight. Recorded as an
 * error entry (the run did not complete) but deliberately outside the strike
 * counter: a deliberate stop is not the routine failing.
 */
export const STOPPED_ROUTINE_RUN_ERROR = 'Stopped from the Agents screen before it finished.'

export const agentRoutineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The agent profile that runs it (its soul/memory ride along), or null. */
  agentSlug: z.string().nullable().catch(null),
  /** The instruction the run receives as its user message. */
  prompt: z.string().min(1),
  /**
   * Script mode (the silent tick): an optional shell command run in the
   * graph root at each occurrence, *before* any model wakes. Exit 0 with no
   * output (or `{"wakeAgent": false}`) records a skipped tick and never
   * starts an agent run; other output wakes the agent with that output as
   * context; a failure counts as a failed run (backoff, then pause).
   */
  script: z.string().nullable().catch(null),
  schedule: routineScheduleSchema,
  enabled: z.boolean().catch(true),
  /** Epoch ms of the last run attempt (success or failure), or null. */
  lastRunMs: z.number().nullable().catch(null),
  /** Notes the last run touched (its activity ledger), newest run only. */
  lastChangedPaths: z.array(z.string()).catch([]),
  /** Past run attempts, newest first, capped at the history limit. */
  runs: z.array(routineRunSchema).catch([]),
  /** Failed attempts since the last success; three in a row pause the routine. */
  consecutiveFailures: z.number().catch(0),
  /** Epoch ms of a scheduled failure retry, or null when none is pending. */
  retryAtMs: z.number().nullable().catch(null),
  /**
   * The prompt suffix the failed run carried (a collection-row event's
   * context), replayed by the retry so an event routine never re-runs
   * blind. Null when no retry is pending or the run had no suffix.
   */
  retryContext: z.string().nullable().catch(null),
})
export type AgentRoutine = z.infer<typeof agentRoutineSchema>

/** The settings-document collection; malformed entries drop, not the list. */
export const agentRoutinesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = agentRoutineSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

/**
 * The most recent scheduled occurrence at or before `now` (local time),
 * epoch ms. Every schedule has one: a daily time looks back at most one
 * day, a weekly one at most a week.
 */
export function latestOccurrenceMs(schedule: ClockSchedule, now: Date): number {
  const [hoursPart, minutesPart] = schedule.time.split(':')
  const hours = Number(hoursPart)
  const minutes = Number(minutesPart)
  const candidate = new Date(now)
  candidate.setHours(hours, minutes, 0, 0)
  if (schedule.kind === 'daily') {
    if (candidate.getTime() > now.getTime()) {
      candidate.setDate(candidate.getDate() - 1)
    }
    return candidate.getTime()
  }
  const dayDelta = (candidate.getDay() - schedule.weekday + 7) % 7
  candidate.setDate(candidate.getDate() - dayDelta)
  if (candidate.getTime() > now.getTime()) {
    candidate.setDate(candidate.getDate() - 7)
  }
  return candidate.getTime()
}

/**
 * Whether the routine should run now: enabled, and its latest scheduled
 * occurrence has not been run yet. A routine the app slept through fires on
 * the next check (launch counts), so a Sunday-evening curator still runs
 * Monday morning when the laptop reopens.
 */
export function routineIsDue(routine: AgentRoutine, now: Date): boolean {
  if (!routine.enabled) {
    return false
  }
  // A pending failure retry outranks the schedule: the occurrence was
  // already consumed when the failed attempt started, so dueness comes
  // from the backoff clock until the routine succeeds or pauses. This is
  // also the one clock path an event routine takes — the retry re-runs
  // with the stored `retryContext`, never context-free.
  if (routine.retryAtMs !== null) {
    return now.getTime() >= routine.retryAtMs
  }
  if (!isClockSchedule(routine.schedule)) {
    return false
  }
  const occurrence = latestOccurrenceMs(routine.schedule, now)
  return routine.lastRunMs === null || routine.lastRunMs < occurrence
}

/**
 * Classify an indexed note against a collection's previous membership.
 * Leaving a collection is not an event — only rows that are members fire.
 */
export function collectionEventKind(
  previousMembers: ReadonlySet<string>,
  path: string,
  isMember: boolean,
): CollectionEventKind | null {
  if (!isMember) {
    return null
  }
  return previousMembers.has(path) ? 'row-updated' : 'row-created'
}

/** Enabled event routines whose tag (folded) and event kind match. */
export function routinesMatchingCollectionEvent(
  routines: readonly AgentRoutine[],
  event: CollectionEventKind,
  tag: string,
): AgentRoutine[] {
  const folded = foldTag(tag)
  return routines.filter(
    (routine) =>
      routine.enabled &&
      isEventSchedule(routine.schedule) &&
      routine.schedule.event === event &&
      foldTag(routine.schedule.tag) === folded,
  )
}

/** Prompt suffix for one event-triggered run; not stored on the routine. */
export function collectionEventPromptSuffix(
  event: CollectionEventKind,
  tag: string,
  path: string,
): string {
  const action = event === 'row-created' ? 'created' : 'updated'
  return `A collection row was ${action} in #${tag}: ${path}`
}

/**
 * The framing every scheduled run carries after its own prompt: no user is
 * present, so the agent works to completion and leaves its trace in the
 * vault instead of asking questions.
 */
export const ROUTINE_RUN_SUFFIX = [
  '',
  'This is a scheduled background run — no user is watching and nobody can answer questions.',
  'Do the work directly and completely. When a decision is ambiguous, pick the conservative option and note it.',
  'Finish by appending a short entry to the shared journal describing what you did.',
].join('\n')

/**
 * The memory curator — the first routine worth having (the maintenance pass
 * Notion's and Hermes's memory systems run): distills the journal into
 * facts, re-grades confidence, prunes the stale, and keeps every memory
 * file under its cap. Offered as a one-click preset in the Agents screen.
 */
export const MEMORY_CURATOR_PRESET: {
  name: string
  prompt: string
  schedule: RoutineSchedule
} = {
  name: 'Memory curator',
  schedule: { kind: 'weekly', weekday: 0, time: '18:00' },
  prompt: [
    'You are this vault’s memory curator. Run a maintenance pass over the agents’ shared memory:',
    '',
    '1. Read agents/memory/log.md. Distill any durable facts or decisions from recent entries into agents/memory/facts.md — one bullet per fact, confidence tag, signed “curator” with today’s date. Update an existing bullet in place rather than adding a contradicting one.',
    '2. Re-grade the existing facts: promote confidence the journal has since confirmed, demote or delete what proved wrong or stale.',
    '3. Trim agents/user.md to what is still true about the user.',
    '4. If any memory file is near its size cap, consolidate it: merge overlapping bullets, rewrite verbose ones shorter.',
    '5. If the journal has grown very long, compress entries older than a month into a single summary entry; leave recent entries untouched.',
  ].join('\n'),
}
