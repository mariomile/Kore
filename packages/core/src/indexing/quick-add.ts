import { addDaysIso, addMonthsIso, isCalendarDate, isoFromParts, weekdayIso } from '@reflect/utils'
import { formatTaskDue } from '../markdown/task-due'
import { withTaskContentPriority, type TaskPriority } from './task-priority'
import { formatTaskRepeat, taskContentRepeat, type TaskRepeat } from './task-repeat'
import type { TaskProject } from './task-views'

/**
 * Quick Add (Todoist-style natural language, slice 2 of `task-come-todoist.md`):
 * turn "chiamare Luca domani alle 15 p1 #Kore" into Kore's canonical task
 * syntax — `!! chiamare Luca [[2026-11-09]] @15:00` — plus the project note it
 * belongs in. Deterministic, offline and instant, Italian and English, so
 * capture never waits on the AI chat.
 *
 * Fixed rules (shown back to the user as chips, so a wrong guess is visible
 * before saving):
 * - A weekday ("venerdì", "friday") is its next occurrence after today, never
 *   today itself ("oggi"/"today" is today).
 * - "prossima settimana" / "next week" is next Monday.
 * - Numeric dates are day/month ("15/11"); a date without a year that has
 *   already passed this year means next year.
 * - Times are 24-hour unless they carry am/pm; a time without a date is today.
 * - Look-alikes stay text: "at 2" needs minutes or am/pm ("alle 3" doesn't),
 *   "1/2" needs a preposition or a year, and month abbreviations that are
 *   everyday words (set, ago, mar, mag, gen, may) need one too.
 * - `p1` is high (`!!`), `p2` medium (`!`), `p3`/`p4` none.
 * - `#Name` is a project only when it names a known project (folder note),
 *   ignoring case, spaces and dashes; any other `#tag` stays in the text.
 * - Only the first match of each kind counts; later ones stay as text.
 *
 * The content is written with core's own task grammar (priority, due date,
 * `@repeat`) so what the chips show is exactly what the index reads back.
 */

export type QuickAddTokenKind = 'date' | 'time' | 'priority' | 'repeat' | 'project'

/** One recognized piece of the input, for the chips. */
export interface QuickAddToken {
  readonly kind: QuickAddTokenKind
  /** The matched input text, as typed. */
  readonly text: string
  readonly start: number
  readonly end: number
}

export interface QuickAdd {
  /** The task's content after the checkbox, in canonical Kore syntax. */
  readonly content: string
  /** The task text with every recognized token removed. */
  readonly title: string
  readonly dueDate: string | null
  readonly dueTime: string | null
  readonly priority: TaskPriority | null
  /** The repeat rule, as core's task grammar reads it back, or null. */
  readonly repeat: TaskRepeat | null
  /** The project note the task belongs in, or null for today's daily note. */
  readonly project: TaskProject | null
  readonly tokens: readonly QuickAddToken[]
}

const L = String.raw`\p{L}\p{N}`
/** Word boundaries that understand accented letters ("lunedì"). */
const B = `(?<![${L}])`
const E = `(?![${L}])`

const WEEKDAYS: Readonly<Record<string, number>> = {
  domenica: 0,
  sunday: 0,
  lunedì: 1,
  lunedi: 1,
  monday: 1,
  mon: 1,
  martedì: 2,
  martedi: 2,
  tuesday: 2,
  tue: 2,
  tues: 2,
  mercoledì: 3,
  mercoledi: 3,
  wednesday: 3,
  wed: 3,
  giovedì: 4,
  giovedi: 4,
  thursday: 4,
  thu: 4,
  thurs: 4,
  venerdì: 5,
  venerdi: 5,
  friday: 5,
  fri: 5,
  sabato: 6,
  saturday: 6,
}

const MONTHS: Readonly<Record<string, number>> = {
  gennaio: 1,
  gen: 1,
  january: 1,
  jan: 1,
  febbraio: 2,
  feb: 2,
  february: 2,
  marzo: 3,
  mar: 3,
  march: 3,
  aprile: 4,
  apr: 4,
  april: 4,
  maggio: 5,
  mag: 5,
  may: 5,
  giugno: 6,
  giu: 6,
  june: 6,
  jun: 6,
  luglio: 7,
  lug: 7,
  july: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  settembre: 9,
  set: 9,
  sett: 9,
  september: 9,
  sep: 9,
  sept: 9,
  ottobre: 10,
  ott: 10,
  october: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  november: 11,
  dicembre: 12,
  dic: 12,
  december: 12,
  dec: 12,
}

function alternation(words: Iterable<string>): string {
  // Longest first, so "martedì" wins over "mar".
  return [...words].sort((left, right) => right.length - left.length).join('|')
}

const WEEKDAY = alternation(Object.keys(WEEKDAYS))
const MONTH = alternation(Object.keys(MONTHS))

type UnitLetter = 'd' | 'w' | 'm' | 'y'

const UNIT_LETTER: Readonly<Record<string, UnitLetter>> = {
  giorno: 'd',
  giorni: 'd',
  day: 'd',
  days: 'd',
  settimana: 'w',
  settimane: 'w',
  week: 'w',
  weeks: 'w',
  mese: 'm',
  mesi: 'm',
  month: 'm',
  months: 'm',
  anno: 'y',
  anni: 'y',
  year: 'y',
  years: 'y',
}
const UNIT = alternation(Object.keys(UNIT_LETTER))

function re(source: string): RegExp {
  return new RegExp(`${B}${source}${E}`, 'iu')
}

interface Match {
  readonly start: number
  readonly end: number
  readonly groups: readonly (string | undefined)[]
}

/**
 * The first match of `pattern` in `text` that doesn't overlap a taken span and
 * that `accept` keeps, so a rejected look-alike ("1/2") doesn't hide a real
 * one later in the line ("15/11").
 */
function find(
  text: string,
  pattern: RegExp,
  taken: readonly Match[],
  accept: (match: Match) => boolean = () => true,
): Match | null {
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
  for (const found of text.matchAll(global)) {
    const start = found.index
    const end = start + found[0].length
    const match = { start, end, groups: found.slice(1) }
    if (taken.every((span) => end <= span.start || start >= span.end) && accept(match)) {
      return match
    }
  }
  return null
}

/** The next `weekday` (0 = Sunday) strictly after `today`. */
function nextWeekday(today: string, weekday: number): string {
  const offset = (weekday - weekdayIso(today) + 7) % 7
  return addDaysIso(today, offset === 0 ? 7 : offset)
}

function shiftBy(today: string, count: number, letter: UnitLetter): string {
  switch (letter) {
    case 'd':
      return addDaysIso(today, count)
    case 'w':
      return addDaysIso(today, count * 7)
    case 'm':
      return addMonthsIso(today, count)
    case 'y':
      return addMonthsIso(today, count * 12)
  }
}

/** A day/month (and optional year) as ISO; a passed date without a year rolls forward. */
function calendarDate(
  today: string,
  day: number,
  month: number,
  year: number | null,
): string | null {
  const fullYear = year === null ? Number(today.slice(0, 4)) : year < 100 ? 2000 + year : year
  const iso = isoFromParts(fullYear, month, day)
  if (month < 1 || month > 12 || !isCalendarDate(iso)) {
    return null
  }
  if (year === null && iso < today) {
    const next = isoFromParts(fullYear + 1, month, day)
    return isCalendarDate(next) ? next : null
  }
  return iso
}

function countWord(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : 1 // "un", "una", "a", "an"
}

const COUNT = String.raw`(\d{1,3}|un|una|a|an)`
const DATE_PREFIX = String.raw`(?:(?:entro|by|on|il|lo)\s+)?`
/** {@link DATE_PREFIX}, captured: an ambiguous date needs it (or a year) to count. */
const CAPTURED_PREFIX = String.raw`(?:(entro|by|on|il|lo)\s+)?`

/**
 * Month abbreviations that are also everyday words ("2 set di piatti", "Set 2
 * reminders", "2 days ago", "may 3 people"): a date only after a preposition
 * ("il 3 set", "by may 3") or with a year ("3 set 2027").
 */
const AMBIGUOUS_MONTHS: ReadonlySet<string> = new Set(['set', 'ago', 'mar', 'mag', 'gen', 'may'])

function monthDate(
  today: string,
  prefix: string | undefined,
  day: string,
  month: string,
  year: string | undefined,
): string | null {
  const key = month.toLowerCase()
  if (AMBIGUOUS_MONTHS.has(key) && prefix === undefined && year === undefined) {
    return null
  }
  return calendarDate(today, Number(day), MONTHS[key]!, year ? Number(year) : null)
}

type DateRule = (groups: readonly (string | undefined)[], today: string) => string | null

const DATE_RULES: readonly (readonly [RegExp, DateRule])[] = [
  [re(String.raw`\[\[(\d{4}-\d{2}-\d{2})\]\]`), ([iso]) => (isCalendarDate(iso!) ? iso! : null)],
  [
    re(String.raw`(\d{4})-(\d{2})-(\d{2})`),
    ([y, m, d], today) => calendarDate(today, Number(d), Number(m), Number(y)),
  ],
  [re(`${DATE_PREFIX}(?:oggi|today|stasera|tonight)`), (_, today) => today],
  [re(`${DATE_PREFIX}(?:dopodomani|day after tomorrow)`), (_, today) => addDaysIso(today, 2)],
  [re(`${DATE_PREFIX}(?:domani|tomorrow|tmr)`), (_, today) => addDaysIso(today, 1)],
  [re('(?:prossima settimana|settimana prossima|next week)'), (_, today) => nextWeekday(today, 1)],
  [
    re(String.raw`(?:tra|fra|in)\s+${COUNT}\s+(${UNIT})`),
    ([count, unit], today) =>
      shiftBy(today, countWord(count!.toLowerCase()), UNIT_LETTER[unit!.toLowerCase()]!),
  ],
  [
    re(String.raw`${CAPTURED_PREFIX}(\d{1,2})\s+(${MONTH})(?:\s+(\d{4}))?`),
    ([prefix, d, m, y], today) => monthDate(today, prefix, d!, m!, y),
  ],
  [
    re(String.raw`${CAPTURED_PREFIX}(${MONTH})\s+(\d{1,2})(?:,?\s+(\d{4}))?`),
    ([prefix, m, d, y], today) => monthDate(today, prefix, d!, m!, y),
  ],
  [
    // "15/11" or "5/11" is a date; "1/2" alone reads as a fraction, so two
    // single digits need a preposition or a year ("il 1/2", "1/2/2027").
    re(String.raw`${CAPTURED_PREFIX}(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?`),
    ([prefix, d, m, y], today) =>
      prefix === undefined && y === undefined && d!.length === 1 && m!.length === 1
        ? null
        : calendarDate(today, Number(d), Number(m), y ? Number(y) : null),
  ],
  [
    re(
      String.raw`${DATE_PREFIX}(?:(?:prossimo|prossima|next|this|questo|questa)\s+)?(${WEEKDAY})(?:\s+(?:prossimo|prossima))?`,
    ),
    ([weekday], today) => nextWeekday(today, WEEKDAYS[weekday!.toLowerCase()]!),
  ],
]

const REPEAT_UNIT: Readonly<Record<UnitLetter, TaskRepeat['unit']>> = {
  d: 'day',
  w: 'week',
  m: 'month',
  y: 'year',
}

/** A rule's repeat, or null when core wouldn't read it back (the words stay text). */
type RepeatRule = (groups: readonly (string | undefined)[]) => {
  repeat: TaskRepeat | null
  weekday?: number
}

function every(count: number, letter: UnitLetter): TaskRepeat | null {
  const repeat: TaskRepeat = { every: count, unit: REPEAT_UNIT[letter] }
  return formatTaskRepeat(repeat) === null ? null : repeat
}

const REPEAT_RULES: readonly (readonly [RegExp, RepeatRule])[] = [
  [
    re(String.raw`@repeat\(\s*([^()\s]+)\s*\)`),
    ([spec]) => ({ repeat: taskContentRepeat(`@repeat(${spec!})`) }),
  ],
  [
    re(String.raw`(?:ogni|every)\s+(\d{1,3})\s+(${UNIT})`),
    ([count, unit]) => ({ repeat: every(Number(count), UNIT_LETTER[unit!.toLowerCase()]!) }),
  ],
  [
    re(String.raw`(?:ogni|every)\s+(${WEEKDAY})`),
    ([weekday]) => ({ repeat: every(1, 'w'), weekday: WEEKDAYS[weekday!.toLowerCase()]! }),
  ],
  [re('(?:ogni giorno|every day|daily)'), () => ({ repeat: every(1, 'd') })],
  [re('(?:ogni settimana|every week|weekly)'), () => ({ repeat: every(1, 'w') })],
  [re('(?:ogni mese|every month|monthly)'), () => ({ repeat: every(1, 'm') })],
  [re('(?:ogni anno|every year|yearly)'), () => ({ repeat: every(1, 'y') })],
]

type Groups = readonly (string | undefined)[]

/**
 * Each time pattern with how its groups map to hour, minute and am/pm (null
 * rejects the match). "alle 3" is a time on its own; English "at 2" needs
 * minutes or am/pm, since "meet at 2 locations" is not 02:00.
 */
const TIME_RULES: readonly (readonly [RegExp, (groups: Groups) => Groups | null])[] = [
  [
    re(String.raw`(alle(?:\s+ore)?|at)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(am|pm))?`),
    ([word, hour, minute, meridiem]) =>
      word!.toLowerCase() === 'at' && !minute && !meridiem ? null : [hour, minute, meridiem],
  ],
  [new RegExp(String.raw`(?<![${L}@])@(\d{1,2}):(\d{2})${E}`, 'iu'), (groups) => groups],
  [re(String.raw`(\d{1,2}):(\d{2})(?:\s*(am|pm))?`), (groups) => groups],
  [re(String.raw`(\d{1,2})\s*(am|pm)`), ([hour, meridiem]) => [hour, undefined, meridiem]],
]

function clockTime(
  hourText: string,
  minuteText: string | undefined,
  meridiem: string | undefined,
): string | null {
  let hour = Number(hourText)
  const minute = minuteText ? Number(minuteText) : 0
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null
    }
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0)
  }
  if (hour > 23 || minute > 59) {
    return null
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const PRIORITY_RULES: readonly (readonly [RegExp, TaskPriority | null])[] = [
  [re('p1'), 'high'],
  [re('p2'), 'medium'],
  [re('p[34]'), null],
  [/(?<!\S)!!(?!\S)/u, 'high'],
  [/(?<!\S)!(?!\S)/u, 'medium'],
]

/** A project's lookup key: lowercased, without spaces, dashes or underscores. */
function projectKey(name: string): string {
  return name.toLowerCase().replaceAll(/[\s_-]+/g, '')
}

/**
 * Parse a Quick Add line. `today` is the app's local ISO day; `projects` are
 * the graph's projects ({@link projectForNote} folder notes) a `#Name` can pick.
 */
export function parseQuickAdd(
  input: string,
  today: string,
  projects: readonly TaskProject[] = [],
): QuickAdd {
  const taken: Match[] = []
  const tokens: QuickAddToken[] = []
  const take = (kind: QuickAddTokenKind, match: Match): void => {
    taken.push(match)
    tokens.push({
      kind,
      text: input.slice(match.start, match.end),
      start: match.start,
      end: match.end,
    })
  }

  let repeat: TaskRepeat | null = null
  let repeatWeekday: number | null = null
  for (const [pattern, rule] of REPEAT_RULES) {
    const match = find(input, pattern, taken)
    if (match === null) {
      continue
    }
    const parsed = rule(match.groups)
    if (parsed.repeat !== null) {
      repeat = parsed.repeat
      repeatWeekday = parsed.weekday ?? null
      take('repeat', match)
      break
    }
  }

  let dueDate: string | null = null
  let dateMatch: Match | null = null
  for (const [pattern, rule] of DATE_RULES) {
    const match = find(input, pattern, taken, (found) => rule(found.groups, today) !== null)
    if (match === null) {
      continue
    }
    const date = rule(match.groups, today)
    if (date !== null && (dateMatch === null || match.start < dateMatch.start)) {
      dueDate = date
      dateMatch = match
    }
  }
  if (dateMatch !== null) {
    take('date', dateMatch)
  }

  let dueTime: string | null = null
  const timeOf = (groups: Groups | null): string | null => {
    if (groups === null) {
      return null
    }
    const [hour, minute, meridiem] = groups
    return clockTime(hour!, minute || undefined, meridiem || undefined)
  }
  for (const [pattern, parts] of TIME_RULES) {
    const match = find(input, pattern, taken, (found) => timeOf(parts(found.groups)) !== null)
    if (match !== null) {
      dueTime = timeOf(parts(match.groups))
      take('time', match)
      break
    }
  }

  let priority: TaskPriority | null = null
  for (const [pattern, value] of PRIORITY_RULES) {
    const match = find(input, pattern, taken)
    if (match !== null) {
      priority = value
      take('priority', match)
      break
    }
  }

  let project: TaskProject | null = null
  const byKey = new Map(projects.map((entry) => [projectKey(entry.title), entry]))
  const tagPattern = new RegExp(`(?<![${L}#])#([${L}_/-]+)`, 'gu')
  for (const found of input.matchAll(tagPattern)) {
    const start = found.index
    const end = start + found[0].length
    const candidate = byKey.get(projectKey(found[1]!))
    if (candidate !== undefined && taken.every((span) => end <= span.start || start >= span.end)) {
      project = candidate
      take('project', { start, end, groups: [] })
      break
    }
  }

  if (dueDate === null && repeatWeekday !== null) {
    dueDate = nextWeekday(today, repeatWeekday)
  }
  if (dueDate === null && (dueTime !== null || repeat !== null)) {
    dueDate = today
  }

  const spans = [...taken].sort((left, right) => left.start - right.start)
  let title = ''
  let cursor = 0
  for (const span of spans) {
    title += `${input.slice(cursor, span.start)} `
    cursor = span.end
  }
  // Core reads the first date link in a task as its due date, so any other
  // `[[YYYY-MM-DD]]` left in the text would outrank the one appended below and
  // contradict the chip: keep it as plain text instead.
  title = `${title}${input.slice(cursor)}`
    .replaceAll(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, '$1')
    .replaceAll(/\s+/g, ' ')
    .trim()

  const parts = [title]
  if (dueDate !== null) {
    parts.push(formatTaskDue(dueDate, dueTime))
  }
  if (repeat !== null) {
    parts.push(formatTaskRepeat(repeat)!)
  }

  return {
    content: title === '' ? '' : withTaskContentPriority(parts.join(' '), priority),
    title,
    dueDate,
    dueTime,
    priority,
    repeat,
    project,
    tokens: tokens.sort((left, right) => left.start - right.start),
  }
}
