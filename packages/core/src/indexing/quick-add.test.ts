import { describe, expect, it } from 'vitest'
import { matchDueTimePrefix } from '../markdown/task-due'
import { parseQuickAdd, QUICK_ADD_MAX_ADDED } from './quick-add'
import { taskContentPriority } from './task-priority'
import { taskContentDueDate, taskContentRepeat } from './task-repeat'

// Sunday 2026-11-08.
const TODAY = '2026-11-08'
const PROJECTS = [
  { path: 'Active/Projects/Kore/Kore.md', title: 'Kore' },
  { path: 'Active/Projects/DeepAgent/DeepAgent.md', title: 'DeepAgent' },
  { path: 'Active/Projects/Job Search 2026/Job Search 2026.md', title: 'Job Search 2026' },
]

function content(input: string): string {
  return parseQuickAdd(input, TODAY, PROJECTS).content
}

describe('parseQuickAdd: canonical content', () => {
  it.each([
    // Italian
    ['chiamare Luca domani alle 15', 'chiamare Luca [[2026-11-09]] @15:00'],
    ['Report entro venerdì p1', '!! Report [[2026-11-13]]'],
    ['dentista dopodomani alle 9:30', 'dentista [[2026-11-10]] @09:30'],
    ['pagare F24 il 16 novembre', 'pagare F24 [[2026-11-16]]'],
    ['rinnovo dominio il 3 gen', 'rinnovo dominio [[2027-01-03]]'],
    ['rinnovo dominio 3 gennaio', 'rinnovo dominio [[2027-01-03]]'],
    ['bolletta 15/11', 'bolletta [[2026-11-15]]'],
    ['review tra 3 giorni p2', '! review [[2026-11-11]]'],
    ['retro prossima settimana', 'retro [[2026-11-09]]'],
    ['palestra ogni lunedì', 'palestra [[2026-11-09]] @repeat(weekly)'],
    ['backup ogni 2 settimane', 'backup [[2026-11-08]] @repeat(2w)'],
    ['annaffiare ogni giorno', 'annaffiare [[2026-11-08]] @repeat(daily)'],
    ['mail investitori oggi', 'mail investitori [[2026-11-08]]'],
    ['comprare il latte', 'comprare il latte'],
    // English
    ['call Anna tomorrow at 3pm', 'call Anna [[2026-11-09]] @15:00'],
    ['ship release next friday', 'ship release [[2026-11-13]]'],
    ['invoice Nov 20', 'invoice [[2026-11-20]]'],
    ['standup every weekday', 'standup every weekday'],
    ['pay rent every month', 'pay rent [[2026-11-08]] @repeat(monthly)'],
    ['taxes in 2 weeks !!', '!! taxes [[2026-11-22]]'],
    // Already canonical syntax passes through
    ['!! fix [[2026-11-12]] @10:00', '!! fix [[2026-11-12]] @10:00'],
  ])('%s', (input, expected) => {
    expect(content(input)).toBe(expected)
  })
})

describe('parseQuickAdd: rules', () => {
  it('a weekday is never today', () => {
    // TODAY is a Sunday.
    expect(parseQuickAdd('x domenica', TODAY).dueDate).toBe('2026-11-15')
  })

  it('a passed date without a year means next year', () => {
    expect(parseQuickAdd('x 1/11', TODAY).dueDate).toBe('2027-11-01')
    expect(parseQuickAdd('x 1/11/2026', TODAY).dueDate).toBe('2026-11-01')
  })

  it('rejects impossible dates and times as text', () => {
    expect(content('x 31/02')).toBe('x 31/02')
    expect(content('x alle 25')).toBe('x alle 25')
  })

  it('#Name picks a known project; other tags stay text', () => {
    const parsed = parseQuickAdd('spec Quick Add #kore #idea', TODAY, PROJECTS)
    expect(parsed.project?.path).toBe('Active/Projects/Kore/Kore.md')
    expect(parsed.content).toBe('spec Quick Add #idea')
    expect(parseQuickAdd('cv #JobSearch2026', TODAY, PROJECTS).project?.title).toBe(
      'Job Search 2026',
    )
    expect(parseQuickAdd('x #kore', TODAY).project).toBeNull()
  })

  it('only the first match of each kind counts', () => {
    expect(content('x domani e poi lunedì')).toBe('x e poi lunedì [[2026-11-09]]')
  })

  it('reports tokens in input order for the chips', () => {
    const parsed = parseQuickAdd('chiamare Luca domani alle 15 p1 #Kore', TODAY, PROJECTS)
    expect(parsed.tokens.map((token) => [token.kind, token.text])).toEqual([
      ['date', 'domani'],
      ['time', 'alle 15'],
      ['priority', 'p1'],
      ['project', '#Kore'],
    ])
  })

  it('an input with only tokens has no content', () => {
    expect(content('domani alle 15')).toBe('')
  })

  it('does not read words inside other words', () => {
    expect(content('lunedìssimo marzapane')).toBe('lunedìssimo marzapane')
    expect(content('update todays notes')).toBe('update todays notes')
  })
})

/** What core's task grammar reads back from written content. */
function readBack(written: string): Record<string, unknown> {
  const dueDate = taskContentDueDate(written)
  const afterLink =
    dueDate === null ? '' : written.slice(written.indexOf(`[[${dueDate}]]`) + dueDate.length + 4)
  return {
    dueDate,
    dueTime: matchDueTimePrefix(afterLink)?.time ?? null,
    priority: taskContentPriority(written),
    repeat: taskContentRepeat(written),
  }
}

describe('parseQuickAdd: core reads back what the chips show', () => {
  it.each([
    'chiamare Luca domani alle 15 p1 ogni lunedì',
    'backup ogni 2 settimane p2',
    'pay rent every month at 9am',
    'x @repeat(3m) 15/11',
    'review [[2026-11-20]] e poi [[2026-11-25]]',
    'call domani and see [[2026-11-25]] @10:00',
    'water plants every 999 days',
  ])('%s', (input) => {
    const parsed = parseQuickAdd(input, TODAY, PROJECTS)
    expect(readBack(parsed.content)).toEqual({
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      repeat: parsed.repeat,
    })
  })

  it('leaves a repeat core would ignore as text', () => {
    const zero = parseQuickAdd('stretch ogni 0 giorni', TODAY)
    expect(zero.repeat).toBeNull()
    expect(zero.content).toBe('stretch ogni 0 giorni')
    const nonsense = parseQuickAdd('x @repeat(foo)', TODAY)
    expect(nonsense.repeat).toBeNull()
    expect(nonsense.content).toBe('x @repeat(foo)')
  })

  it('keeps a second date link as plain text so the chip date stays the due date', () => {
    const parsed = parseQuickAdd('review [[2026-11-20]] e poi [[2026-11-25]]', TODAY)
    expect(parsed.dueDate).toBe('2026-11-20')
    expect(parsed.content).toBe('review e poi 2026-11-25 [[2026-11-20]]')
  })

  it('types the repeat rule', () => {
    expect(parseQuickAdd('backup ogni 2 settimane', TODAY).repeat).toEqual({
      every: 2,
      unit: 'week',
    })
    expect(parseQuickAdd('x weekly', TODAY).repeat).toEqual({ every: 1, unit: 'week' })
  })
})

describe('parseQuickAdd: everyday words are not dates or times', () => {
  it.each([
    ['Set 2 reminders', 'Set 2 reminders'],
    ['compra 2 set di piatti', 'compra 2 set di piatti'],
    ['meet at 2 locations', 'meet at 2 locations'],
    ['fai 1/2 del lavoro', 'fai 1/2 del lavoro'],
    ['sent 3 days ago', 'sent 3 days ago'],
    ['may 3 people join', 'may 3 people join'],
    ['2 mar di bottiglie', '2 mar di bottiglie'],
  ])('%s', (input, expected) => {
    const parsed = parseQuickAdd(input, TODAY)
    expect(parsed.content).toBe(expected)
    expect(parsed.tokens).toEqual([])
  })

  it.each([
    ['visita il 2 set', 'visita [[2027-09-02]]'],
    ['call by may 3', 'call [[2027-05-03]]'],
    ['ferie 3 ago 2027', 'ferie [[2027-08-03]]'],
    ['bolletta il 1/2', 'bolletta [[2027-02-01]]'],
    ['bolletta 5/11', 'bolletta [[2027-11-05]]'],
    ['1/2 torta e poi 15/11', '1/2 torta e poi [[2026-11-15]]'],
    ['meet at 2pm', 'meet [[2026-11-08]] @14:00'],
    ['meet at 2:30', 'meet [[2026-11-08]] @02:30'],
    ['chiamare alle 3', 'chiamare [[2026-11-08]] @03:00'],
  ])('still reads %s', (input, expected) => {
    expect(content(input)).toBe(expected)
  })
})

describe('parseQuickAdd: length', () => {
  it('never grows its input by more than QUICK_ADD_MAX_ADDED', () => {
    const input = `${'x'.repeat(200)} domani alle 15 p1 ogni mese`
    const worst = parseQuickAdd('x !! domani alle 23:59 monthly', TODAY).content
    expect(worst.length - 'x'.length).toBeLessThanOrEqual(QUICK_ADD_MAX_ADDED)
    expect(parseQuickAdd(input, TODAY).content.length).toBeLessThanOrEqual(
      input.length + QUICK_ADD_MAX_ADDED,
    )
  })
})
