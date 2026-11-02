/**
 * What keeps a vault-sized Graph view readable: how big a node draws, which
 * notes count as hubs, how loud the edges are, and where labels may go. The
 * canvas draws; these decide. Pure and dependency-free so a test can pin
 * the rules without a canvas.
 */

/** Inbound links past which a node stops growing (keeps giants on screen). */
const RADIUS_INBOUND_CAP = 100

/**
 * A node's radius in layout units. Square-root growth keeps hubs apart from
 * one another: the old linear ramp stopped at 14 links, so in a big vault
 * every hub drew the same size as a note with a dozen backlinks.
 */
export function nodeRadius(inbound: number): number {
  return 3 + 1.5 * Math.sqrt(Math.min(Math.max(inbound, 0), RADIUS_INBOUND_CAP))
}

/** The fewest inbound links that make a hub, whatever the graph's size. */
const HUB_MIN_INBOUND = 5
/** Share of linked notes that read as hubs. */
const HUB_SHARE = 0.02

/**
 * The inbound count from which a note draws as a hub: the top
 * {@link HUB_SHARE} of notes by inbound links, never below
 * {@link HUB_MIN_INBOUND}. Hubs paint above other circles and their names
 * set darker and bolder, so a map's structure reads before its leaves.
 */
export function hubThreshold(inbounds: readonly number[]): number {
  const linked = inbounds.filter((count) => count > 0).sort((a, b) => b - a)
  if (linked.length === 0) {
    return Infinity
  }
  const rank = Math.max(0, Math.ceil(linked.length * HUB_SHARE) - 1)
  return Math.max(HUB_MIN_INBOUND, linked[rank] ?? HUB_MIN_INBOUND)
}

/**
 * Base edge opacity for a graph with this many edges. Thousands of strokes
 * stack into a grey fog that hides the nodes, so a dense map draws each edge
 * fainter — the cluster still reads as dense, the circles stay visible.
 * Small graphs (a local graph, a young vault) keep full strength.
 */
export function edgeDensityAlpha(edgeCount: number): number {
  const FULL_UNTIL = 1000
  const FLOOR_FROM = 20000
  const FLOOR = 0.35
  if (edgeCount <= FULL_UNTIL) {
    return 1
  }
  const t = Math.min(1, Math.log(edgeCount / FULL_UNTIL) / Math.log(FLOOR_FROM / FULL_UNTIL))
  return 1 - (1 - FLOOR) * t
}

/** Labels for a node whose circle draws at least this wide on screen (px radius). */
export const LABEL_MIN_SCREEN_RADIUS = 7
/** The biggest hubs keep their names even fully zoomed out. */
export const ALWAYS_LABELED_HUBS = 10
/** Breathing room kept around every placed label, in screen px. */
export const LABEL_GAP_X = 6
export const LABEL_GAP_Y = 3

export interface LabelRect {
  x: number
  y: number
  w: number
  h: number
}

export interface LabelIndex {
  /** True when the rect, grown by the label gap, clears every placed label. */
  fits: (rect: LabelRect) => boolean
  add: (rect: LabelRect) => void
}

/**
 * Screen-space collision index for labels: a uniform grid of buckets, so a
 * vault-sized map checks a label against its few neighbors, not every name
 * already placed.
 */
export function createLabelIndex(cellSize = 96): LabelIndex {
  const buckets = new Map<string, LabelRect[]>()
  const cellsOf = (rect: LabelRect, visit: (key: string) => boolean | void): boolean => {
    const x0 = Math.floor(rect.x / cellSize)
    const x1 = Math.floor((rect.x + rect.w) / cellSize)
    const y0 = Math.floor(rect.y / cellSize)
    const y1 = Math.floor((rect.y + rect.h) / cellSize)
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        if (visit(`${cx},${cy}`) === false) {
          return false
        }
      }
    }
    return true
  }
  const grow = (rect: LabelRect): LabelRect => ({
    x: rect.x - LABEL_GAP_X,
    y: rect.y - LABEL_GAP_Y,
    w: rect.w + LABEL_GAP_X * 2,
    h: rect.h + LABEL_GAP_Y * 2,
  })
  return {
    fits: (rect) => {
      const padded = grow(rect)
      return cellsOf(padded, (key) => {
        for (const other of buckets.get(key) ?? []) {
          if (
            padded.x < other.x + other.w &&
            padded.x + padded.w > other.x &&
            padded.y < other.y + other.h &&
            padded.y + padded.h > other.y
          ) {
            return false
          }
        }
        return true
      })
    },
    add: (rect) => {
      cellsOf(rect, (key) => {
        const bucket = buckets.get(key)
        if (bucket === undefined) {
          buckets.set(key, [rect])
        } else {
          bucket.push(rect)
        }
      })
    },
  }
}
