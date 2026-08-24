import type { RoutineSchedule } from '@reflect/core'

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** Human-readable trigger for a routine's schedule. */
export function scheduleLabel(schedule: RoutineSchedule): string {
  if (schedule.kind === 'event') {
    const action = schedule.event === 'row-created' ? 'created' : 'updated'
    return `When a #${schedule.tag} row is ${action}`
  }
  return schedule.kind === 'daily'
    ? `Daily at ${schedule.time}`
    : `${WEEKDAY_LABELS[schedule.weekday]}s at ${schedule.time}`
}
