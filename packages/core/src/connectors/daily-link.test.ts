import { describe, expect, it } from 'vitest'
import { withDailyLinks } from './daily-link'

describe('withDailyLinks', () => {
  it('adds new notes under the heading in time order and skips ones already linked', () => {
    const source = [
      '### Meetings',
      '',
      '- 09:32 [[Input/Granola/Standup, 2026-11-16|Standup]]',
      '',
    ].join('\n')
    const next = withDailyLinks(source, 'Meetings', [
      { path: 'Granola/2026-11-16 Review.md', title: 'Review', date: '2026-11-16', time: '16:00' },
      {
        path: 'Input/Granola/Standup, 2026-11-16.md',
        title: 'Standup',
        date: '2026-11-16',
        time: '09:32',
      },
      { path: 'Granola/2026-11-16 Lunch.md', title: 'Lunch', date: '2026-11-16', time: '12:30' },
    ])
    expect(next).toBe(
      [
        '### Meetings',
        '',
        '- 09:32 [[Input/Granola/Standup, 2026-11-16|Standup]]',
        '- 12:30 [[Granola/2026-11-16 Lunch|Lunch]]',
        '- 16:00 [[Granola/2026-11-16 Review|Review]]',
        '',
      ].join('\n'),
    )
    expect(
      withDailyLinks(next, 'Meetings', [
        { path: 'Granola/2026-11-16 Lunch.md', title: 'Lunch', date: '2026-11-16', time: '12:30' },
      ]),
    ).toBe(next)
  })
})
