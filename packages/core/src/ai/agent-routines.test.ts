import { describe, expect, it } from 'vitest'
import {
  agentRoutinesSchema,
  appendRoutineRun,
  latestOccurrenceMs,
  routineIsDue,
  ROUTINE_RUN_HISTORY_LIMIT,
  type AgentRoutine,
  type RoutineRun,
} from './agent-routines'

/** 2026-08-26 was a Wednesday (weekday 3). */
const WEDNESDAY_NOON = new Date(2026, 7, 26, 12, 0, 0)

function routine(overrides: Partial<AgentRoutine>): AgentRoutine {
  return {
    id: 'r1',
    name: 'Test',
    agentSlug: null,
    prompt: 'do the thing',
    schedule: { kind: 'daily', time: '08:00' },
    enabled: true,
    lastRunMs: null,
    lastChangedPaths: [],
    runs: [],
    ...overrides,
  }
}

describe('latestOccurrenceMs', () => {
  it('finds today’s time when it has passed, yesterday’s when not', () => {
    const morning = latestOccurrenceMs({ kind: 'daily', time: '08:00' }, WEDNESDAY_NOON)
    expect(new Date(morning).getHours()).toBe(8)
    expect(new Date(morning).getDate()).toBe(26)

    const evening = latestOccurrenceMs({ kind: 'daily', time: '18:00' }, WEDNESDAY_NOON)
    expect(new Date(evening).getDate()).toBe(25)
    expect(new Date(evening).getHours()).toBe(18)
  })

  it('walks back to the scheduled weekday, up to a full week', () => {
    // Sunday 18:00 as seen from Wednesday noon → the past Sunday.
    const sunday = latestOccurrenceMs({ kind: 'weekly', weekday: 0, time: '18:00' }, WEDNESDAY_NOON)
    expect(new Date(sunday).getDay()).toBe(0)
    expect(new Date(sunday).getDate()).toBe(23)

    // Wednesday 18:00 as seen from Wednesday noon → LAST Wednesday.
    const lastWednesday = latestOccurrenceMs(
      { kind: 'weekly', weekday: 3, time: '18:00' },
      WEDNESDAY_NOON,
    )
    expect(new Date(lastWednesday).getDate()).toBe(19)

    // Wednesday 08:00 as seen from Wednesday noon → this morning.
    const thisMorning = latestOccurrenceMs(
      { kind: 'weekly', weekday: 3, time: '08:00' },
      WEDNESDAY_NOON,
    )
    expect(new Date(thisMorning).getDate()).toBe(26)
  })
})

describe('routineIsDue', () => {
  it('fires when the latest occurrence has not been run, launch included', () => {
    expect(routineIsDue(routine({ lastRunMs: null }), WEDNESDAY_NOON)).toBe(true)
    const beforeOccurrence = new Date(2026, 7, 26, 7, 0).getTime()
    expect(routineIsDue(routine({ lastRunMs: beforeOccurrence }), WEDNESDAY_NOON)).toBe(true)
    const afterOccurrence = new Date(2026, 7, 26, 9, 0).getTime()
    expect(routineIsDue(routine({ lastRunMs: afterOccurrence }), WEDNESDAY_NOON)).toBe(false)
  })

  it('never fires while disabled', () => {
    expect(routineIsDue(routine({ enabled: false }), WEDNESDAY_NOON)).toBe(false)
  })
})

describe('agentRoutinesSchema', () => {
  it('drops malformed entries without dropping the list', () => {
    const parsed = agentRoutinesSchema.parse([
      routine({}),
      { id: 'broken' },
      routine({ id: 'r2', schedule: { kind: 'weekly', weekday: 0, time: '18:00' } }),
    ])
    expect(parsed.map((entry) => entry.id)).toEqual(['r1', 'r2'])
  })

  it('degrades a non-array to the empty list', () => {
    expect(agentRoutinesSchema.parse('nope')).toEqual([])
  })

  it('parses pre-history entries (no runs key) with an empty history', () => {
    const { runs: _omitted, ...legacy } = routine({})
    const parsed = agentRoutinesSchema.parse([legacy])
    expect(parsed[0]?.runs).toEqual([])
  })
})

describe('appendRoutineRun', () => {
  const run = (startedMs: number): RoutineRun => ({
    startedMs,
    status: 'ok',
    error: null,
    changedPaths: [],
  })

  it('prepends newest first and caps the history', () => {
    let runs: RoutineRun[] = []
    for (let index = 0; index < ROUTINE_RUN_HISTORY_LIMIT + 5; index += 1) {
      runs = appendRoutineRun(runs, run(index))
    }
    expect(runs).toHaveLength(ROUTINE_RUN_HISTORY_LIMIT)
    expect(runs[0]?.startedMs).toBe(ROUTINE_RUN_HISTORY_LIMIT + 4)
    expect(runs.at(-1)?.startedMs).toBe(5)
  })
})
