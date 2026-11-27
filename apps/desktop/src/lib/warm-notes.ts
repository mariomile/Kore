/**
 * Note tabs a pane keeps drawn while another tab is showing. Switching to a
 * tab used to rebuild its note from scratch: on a long note that was 1.5 s of
 * frozen window every time, the same price as opening it cold. A warm note is
 * kept mounted, out of layout and paint (`.kore-warm-note`), so showing it
 * again costs one style flip. Bounded, because each one keeps its DOM alive.
 */
export const WARM_NOTE_LIMIT = 5

export interface WarmNote {
  path: string
  /** Show order: higher was on screen more recently. */
  shownAt: number
}

/**
 * The notes to keep mounted, in mount order. The order never changes for a
 * note that stays: React moving its subtree would detach it, losing its
 * scroll and reloading its embeds. Eviction drops the least recently shown.
 * Returns `warm` itself when nothing changes.
 */
export function nextWarmNotes(
  warm: readonly WarmNote[],
  activePath: string | null,
  openPaths: ReadonlySet<string>,
): readonly WarmNote[] {
  const latest = Math.max(0, ...warm.map((note) => note.shownAt))
  const active = warm.find((note) => note.path === activePath)
  const activeIsLatest = active !== undefined && active.shownAt === latest
  const stale = warm.some((note) => note.path !== activePath && !openPaths.has(note.path))
  if ((activePath === null || activeIsLatest) && !stale) {
    return warm
  }
  let next = warm
    .filter((note) => note.path === activePath || openPaths.has(note.path))
    .map((note) =>
      note.path === activePath && !activeIsLatest ? { ...note, shownAt: latest + 1 } : note,
    )
  if (activePath !== null && active === undefined) {
    next = [...next, { path: activePath, shownAt: latest + 1 }]
  }
  while (next.length > WARM_NOTE_LIMIT) {
    const coldest = next.reduce((a, b) => (b.shownAt < a.shownAt ? b : a))
    next = next.filter((note) => note !== coldest)
  }
  return next
}
