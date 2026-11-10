import { describe, expect, it } from 'vitest'
import {
  countTaskTags,
  parseTaskQuery,
  taskHasTags,
  taskTagKeys,
  toggleQueryTag,
} from './task-tags'

const line = (raw: string) => ({ raw })

describe('task tags', () => {
  it('splits a search into #tags and free text', () => {
    expect(parseTaskQuery('  call #Work anna #work #errands ')).toEqual({
      text: 'call anna',
      tags: ['work', 'errands'],
    })
    // `#123` and a lone `#` are not tags, so they stay text.
    expect(parseTaskQuery('# #123')).toEqual({ text: '# #123', tags: [] })
  })

  it("reads a task's own tags by the indexer's rules", () => {
    expect(taskTagKeys(line('[ ] ship #Kore `#not` [[#nope]] #work/side'))).toEqual([
      'kore',
      'work/side',
    ])
  })

  it('matches every tag, a parent covering its children', () => {
    const task = line('[ ] ship #work/kore #urgent')
    expect(taskHasTags(task, [])).toBe(true)
    expect(taskHasTags(task, ['work'])).toBe(true)
    expect(taskHasTags(task, ['work', 'urgent'])).toBe(true)
    expect(taskHasTags(task, ['work/kore/x'])).toBe(false)
    expect(taskHasTags(task, ['wor'])).toBe(false)
  })

  it('counts the tags tasks use, most used first', () => {
    expect(
      countTaskTags([line('[ ] a #Home'), line('[ ] b #work #home'), line('[ ] c #work')]),
    ).toEqual([
      { tag: 'Home', key: 'home', count: 2 },
      { tag: 'work', key: 'work', count: 2 },
    ])
  })

  it('toggles a #tag in the search', () => {
    expect(toggleQueryTag('call', 'work')).toBe('call #work')
    expect(toggleQueryTag('call #Work', 'work')).toBe('call')
    expect(toggleQueryTag('', 'work')).toBe('#work')
  })
})
