import { describe, expect, it } from 'vitest'
import { dailyWidgetSnapshot } from './daily-widget'

describe('dailyWidgetSnapshot', () => {
  it('lists open tasks in order, counts done ones, and previews the prose', () => {
    const source = [
      '- [ ] Call the **bank**',
      '- [x] Ship the release',
      '- Met [[Anna|Anna B.]] about the launch',
      '- [ ] Review the roadmap',
      '',
    ].join('\n')

    const snapshot = dailyWidgetSnapshot(source, '2026-11-13')

    expect(snapshot).toMatchObject({
      date: '2026-11-13',
      openTasks: ['Call the bank', 'Review the roadmap'],
      openTaskCount: 2,
      doneTaskCount: 1,
    })
    expect(snapshot.preview).toContain('Anna B. about the launch')
    expect(snapshot.preview).not.toContain('Call the bank')
  })

  it('reads an empty day as empty', () => {
    expect(dailyWidgetSnapshot('', '2026-11-13')).toEqual({
      date: '2026-11-13',
      preview: '',
      openTasks: [],
      openTaskCount: 0,
      doneTaskCount: 0,
    })
  })
})
