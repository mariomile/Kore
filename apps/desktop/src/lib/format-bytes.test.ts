import { describe, expect, it } from 'vitest'
import { formatBytes } from './format-bytes'

describe('formatBytes', () => {
  it('reports gigabyte-scale sizes with one decimal', () => {
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1.3 GB')
  })

  it('reports megabyte-scale sizes as whole megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('never rounds a non-empty file down to zero', () => {
    expect(formatBytes(12)).toBe('1 KB')
  })
})
