import { describe, expect, it } from 'vitest'
import { columnsThatFit, dealIntoColumns } from './deal-columns'

describe('dealIntoColumns', () => {
  it('deals row by row so the grid reads in list order', () => {
    expect(dealIntoColumns([1, 2, 3, 4, 5], 3)).toEqual([[1, 4], [2, 5], [3]])
  })

  it('always keeps at least one column', () => {
    expect(dealIntoColumns(['a', 'b'], 0)).toEqual([['a', 'b']])
  })
})

describe('columnsThatFit', () => {
  it('counts the columns of a minimum width, gaps included', () => {
    expect(columnsThatFit(1000, 272, 20)).toBe(3)
    expect(columnsThatFit(564, 272, 20)).toBe(2)
    expect(columnsThatFit(563, 272, 20)).toBe(1)
    expect(columnsThatFit(0, 272, 20)).toBe(1)
  })
})
