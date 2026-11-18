import { describe, expect, it } from 'vitest'
import type { CollectionEntry, TagProperty } from '@kore/core'
import { shiftSpan, timelineFieldsOf, timelineSpanOf, timelineWindowOf } from './timeline-layout'

const date = (key: string, name = key): TagProperty => ({ key, name, type: 'date' })

function entry(properties: Record<string, string>): CollectionEntry {
  return {
    path: 'notes/a.md',
    title: 'A',
    mtime: 0,
    isPinned: false,
    properties: Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        { value, valueType: 'string' as const, valueNumber: null },
      ]),
    ),
  }
}

describe('timeline layout', () => {
  it('picks start and end fields by name, then by schema order', () => {
    const fields = timelineFieldsOf([date('due', 'Due'), date('kickoff', 'Start')])
    expect(fields?.start.key).toBe('kickoff')
    expect(fields?.end?.key).toBe('due')
    expect(timelineFieldsOf([date('a'), date('b')])).toMatchObject({
      start: { key: 'a' },
      end: { key: 'b' },
    })
    expect(timelineFieldsOf([date('a')])?.end).toBeNull()
    expect(timelineFieldsOf([{ key: 'x', name: 'X', type: 'text' }])).toBeNull()
  })

  it('reads a span, tolerating a missing or backwards end', () => {
    const fields = timelineFieldsOf([date('start'), date('end')])
    if (fields === null) {
      throw new Error('expected fields')
    }
    expect(timelineSpanOf(entry({ start: '2026-11-10', end: '2026-11-12' }), fields)).toEqual({
      start: '2026-11-10',
      end: '2026-11-12',
      days: 3,
    })
    expect(timelineSpanOf(entry({ start: '2026-11-10', end: '2026-11-01' }), fields)?.days).toBe(1)
    expect(timelineSpanOf(entry({ end: '2026-11-12T09:00' }), fields)?.start).toBe('2026-11-12')
    expect(timelineSpanOf(entry({ start: 'soon' }), fields)).toBeNull()
  })

  it('moves a bar or one edge without crossing the other', () => {
    const span = { start: '2026-11-10', end: '2026-11-12', days: 3 }
    expect(shiftSpan(span, 'move', 2)).toEqual({ start: '2026-11-12', end: '2026-11-14', days: 3 })
    expect(shiftSpan(span, 'end', -5)).toEqual({ start: '2026-11-10', end: '2026-11-10', days: 1 })
    expect(shiftSpan(span, 'start', 1).days).toBe(2)
  })

  it('opens the window on a week start, around the bars and today', () => {
    const window = timelineWindowOf(
      [{ start: '2026-11-10', end: '2026-12-20', days: 41 }],
      '2026-11-17',
      'week',
      1,
    )
    expect(new Date(`${window.start}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(window.start <= '2026-10-27').toBe(true)
    expect(window.days % 7).toBe(0)
  })
})
