/**
 * Pure scheduling for task notifications: the daily digest covers date-only
 * due/overdue tasks, and timed tasks (`@HH:MM` after the due-date link) fire
 * once when that local time is reached on the due date.
 */

export interface ReminderTask {
  readonly notePath: string
  readonly markerOffset: number
  readonly text: string
  readonly dueDate: string | null
  readonly dueTime: string | null
}

export interface DigestCounts {
  readonly dueToday: number
  readonly overdue: number
}

/** Minutes since local midnight for a stored `HH:MM`, or null if malformed. */
export function dueTimeToMinutes(dueTime: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(dueTime)
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }
  return hour * 60 + minute
}

/** Date-only due-today count plus every overdue task (timed or not). */
export function digestCounts(tasks: readonly ReminderTask[], today: string): DigestCounts {
  let dueToday = 0
  let overdue = 0
  for (const task of tasks) {
    if (task.dueDate === null) {
      continue
    }
    if (task.dueDate < today) {
      overdue += 1
    } else if (task.dueDate === today && task.dueTime == null) {
      dueToday += 1
    }
  }
  return { dueToday, overdue }
}

/** Stable id for one punctual firing on a given due date+time. */
export function punctualTaskKey(task: ReminderTask): string {
  return `${task.notePath}:${String(task.markerOffset)}:${task.dueDate ?? ''}:${task.dueTime ?? ''}`
}

/**
 * Timed tasks due today whose clock time has been reached and that have not
 * already fired this day.
 */
export function punctualTasksReady(
  tasks: readonly ReminderTask[],
  today: string,
  nowMinutes: number,
  alreadyFired: ReadonlySet<string>,
): ReminderTask[] {
  const ready: ReminderTask[] = []
  for (const task of tasks) {
    if (task.dueDate !== today || task.dueTime == null) {
      continue
    }
    const minutes = dueTimeToMinutes(task.dueTime)
    if (minutes === null || minutes > nowMinutes) {
      continue
    }
    const key = punctualTaskKey(task)
    if (!alreadyFired.has(key)) {
      ready.push(task)
    }
  }
  return ready
}

/** Notification body for one timed task. */
export function punctualReminderBody(task: ReminderTask): string {
  const label = task.text.trim()
  const when = task.dueTime ?? ''
  if (label === '') {
    return when === '' ? 'Open task' : `Open task at ${when}`
  }
  return when === '' ? label : `${label} · ${when}`
}

export interface PunctualFireState {
  readonly day: string
  readonly keys: readonly string[]
}

export function parsePunctualFireState(raw: string | null, today: string): Set<string> {
  if (raw === null || raw === '') {
    return new Set()
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('day' in parsed) ||
      !('keys' in parsed) ||
      typeof parsed.day !== 'string' ||
      !Array.isArray(parsed.keys)
    ) {
      return new Set()
    }
    if (parsed.day !== today) {
      return new Set()
    }
    return new Set(parsed.keys.filter((key): key is string => typeof key === 'string'))
  } catch {
    return new Set()
  }
}

export function serializePunctualFireState(today: string, keys: ReadonlySet<string>): string {
  return JSON.stringify({ day: today, keys: [...keys] } satisfies PunctualFireState)
}
