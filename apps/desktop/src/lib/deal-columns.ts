/**
 * Deal items across `count` columns left to right, row by row, so a masonry
 * grid reads in the list's order: the newest note top left, the second
 * newest beside it. CSS columns would fill the whole left column first,
 * splitting a recency sort into "left half newer than right half".
 */
export function dealIntoColumns<T>(items: readonly T[], count: number): T[][] {
  const columns: T[][] = Array.from({ length: Math.max(1, count) }, () => [])
  for (const [index, item] of items.entries()) {
    columns[index % columns.length]?.push(item)
  }
  return columns
}

/** How many columns of at least `minWidth` (with `gap` between them) fit in `width`. */
export function columnsThatFit(width: number, minWidth: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
}
