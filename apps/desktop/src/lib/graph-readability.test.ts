import { describe, expect, it } from 'vitest'
import {
  LABEL_GAP_X,
  createLabelIndex,
  edgeDensityAlpha,
  hubThreshold,
  nodeRadius,
} from './graph-readability'

describe('graph readability', () => {
  it('keeps growing hubs past the old 14-link ceiling', () => {
    expect(nodeRadius(0)).toBe(3)
    expect(nodeRadius(14)).toBeLessThan(nodeRadius(40))
    expect(nodeRadius(40)).toBeLessThan(nodeRadius(100))
    // A giant does not swallow the canvas.
    expect(nodeRadius(5000)).toBe(nodeRadius(100))
    expect(nodeRadius(-3)).toBe(nodeRadius(0))
  })

  it('names the top two percent of linked notes as hubs, never below five links', () => {
    // 200 linked notes: the top 2% is the fourth-best count.
    const inbounds = [...Array.from({ length: 196 }, () => 2), 9, 12, 30, 80, 0, 0]
    expect(hubThreshold(inbounds)).toBe(9)
    // A small graph's best note with three links is not a hub.
    expect(hubThreshold([3, 1, 1, 0])).toBe(5)
    expect(hubThreshold([0, 0])).toBe(Infinity)
    expect(hubThreshold([])).toBe(Infinity)
  })

  it('fades edges on dense maps only', () => {
    expect(edgeDensityAlpha(0)).toBe(1)
    expect(edgeDensityAlpha(1000)).toBe(1)
    expect(edgeDensityAlpha(5000)).toBeLessThan(1)
    expect(edgeDensityAlpha(5000)).toBeGreaterThan(edgeDensityAlpha(20000))
    expect(edgeDensityAlpha(20000)).toBeCloseTo(0.35)
    expect(edgeDensityAlpha(500000)).toBeCloseTo(0.35)
  })

  it('refuses a label that crowds a placed one, across grid cells', () => {
    const labels = createLabelIndex(50)
    const first = { x: 40, y: 40, w: 100, h: 14 }
    expect(labels.fits(first)).toBe(true)
    labels.add(first)
    // Overlapping, and merely too close (inside the gap), both refused.
    expect(labels.fits({ x: 120, y: 45, w: 60, h: 14 })).toBe(false)
    expect(labels.fits({ x: 140 + LABEL_GAP_X - 1, y: 40, w: 60, h: 14 })).toBe(false)
    // Clear of the gap: accepted.
    expect(labels.fits({ x: 140 + LABEL_GAP_X * 2 + 1, y: 40, w: 60, h: 14 })).toBe(true)
    expect(labels.fits({ x: 40, y: 80, w: 100, h: 14 })).toBe(true)
  })
})
