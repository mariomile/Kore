import { describe, expect, it } from 'vitest'
import {
  compareTaskPriority,
  cycleTaskContentPriority,
  stripTaskContentPriority,
  taskContentPriority,
  taskRawPriority,
  withTaskContentPriority,
} from './task-priority'

describe('taskContentPriority', () => {
  it('reads a standalone leading bang run', () => {
    expect(taskContentPriority('! buy milk')).toBe('medium')
    expect(taskContentPriority('!! pay taxes')).toBe('high')
    expect(taskContentPriority('buy milk')).toBeNull()
  })

  it('treats attached or long bang runs as prose', () => {
    expect(taskContentPriority('!important thing')).toBeNull()
    expect(taskContentPriority('!!! so exciting')).toBeNull()
  })

  it('reads a bare marker with no text after it', () => {
    expect(taskContentPriority('!')).toBe('medium')
    expect(taskContentPriority('!!')).toBe('high')
  })
})

describe('stripTaskContentPriority', () => {
  it('removes the marker and its separating space', () => {
    expect(stripTaskContentPriority('!! pay taxes')).toBe('pay taxes')
    expect(stripTaskContentPriority('! buy milk')).toBe('buy milk')
    expect(stripTaskContentPriority('buy milk')).toBe('buy milk')
  })
})

describe('withTaskContentPriority', () => {
  it('adds, replaces, and clears the marker', () => {
    expect(withTaskContentPriority('buy milk', 'high')).toBe('!! buy milk')
    expect(withTaskContentPriority('! buy milk', 'high')).toBe('!! buy milk')
    expect(withTaskContentPriority('!! buy milk', null)).toBe('buy milk')
  })
})

describe('cycleTaskContentPriority', () => {
  it('walks none → medium → high → none', () => {
    expect(cycleTaskContentPriority('buy milk')).toBe('! buy milk')
    expect(cycleTaskContentPriority('! buy milk')).toBe('!! buy milk')
    expect(cycleTaskContentPriority('!! buy milk')).toBe('buy milk')
  })
})

describe('taskRawPriority', () => {
  it('skips the checkbox marker before reading', () => {
    expect(taskRawPriority('[ ] !! pay taxes')).toBe('high')
    expect(taskRawPriority('[x] ! done thing')).toBe('medium')
    expect(taskRawPriority('[ ] buy milk')).toBeNull()
  })

  it('returns null for a line that is not a task marker', () => {
    expect(taskRawPriority('!! not a task')).toBeNull()
  })
})

describe('compareTaskPriority', () => {
  it('ranks high before medium before none', () => {
    expect(compareTaskPriority('high', 'medium')).toBeLessThan(0)
    expect(compareTaskPriority('medium', null)).toBeLessThan(0)
    expect(compareTaskPriority(null, 'high')).toBeGreaterThan(0)
    expect(compareTaskPriority('high', 'high')).toBe(0)
  })
})
