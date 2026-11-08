import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './quick-add'

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
    ['rinnovo dominio 3 gen', 'rinnovo dominio [[2027-01-03]]'],
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
