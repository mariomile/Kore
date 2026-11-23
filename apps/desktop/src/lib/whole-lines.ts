/** Slack for fractional layout: a line this close to an edge counts as inside it. */
const LINE_TOLERANCE_PX = 1

/**
 * Where to cut a clipped box so that it ends on a whole line of text: the
 * bottom of the last line that fits, in viewport px. `null` when nothing is
 * cut (the content fits, or holds no text to end on).
 *
 * A box cut at a fixed height slices whatever line happens to sit there, and
 * a fade over half a line shows the tops of its letters and marks. Lines are
 * read from the text itself, so paragraphs, list items and table rows all
 * count, whatever boxes wrap them.
 */
export function lastWholeLineBottom(box: Element): number | null {
  const limit = box.getBoundingClientRect().bottom
  const range = document.createRange()
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
  // Bottoms of the lines that fit, and the top of the first that does not.
  const fitting: number[] = []
  let cutTop = Infinity
  while (walker.nextNode() !== null) {
    range.selectNodeContents(walker.currentNode)
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) {
        continue
      }
      if (rect.bottom > limit + LINE_TOLERANCE_PX) {
        cutTop = Math.min(cutTop, rect.top)
      } else {
        fitting.push(rect.bottom)
      }
    }
  }
  if (cutTop === Infinity) {
    return null
  }
  // Smaller text on the cut line itself fits the box, but is not a line to end on.
  let bottom: number | null = null
  for (const candidate of fitting) {
    if (candidate <= cutTop + LINE_TOLERANCE_PX && (bottom === null || candidate > bottom)) {
      bottom = candidate
    }
  }
  return bottom
}
