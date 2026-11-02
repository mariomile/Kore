import { useSyncExternalStore } from 'react'

/**
 * Live titles of notes still on their untitled placeholder path (Plan 17's
 * birth rename), published by the open note's rename coordinator on every
 * save. The file keeps its ULID name until the title settles (5s of quiet,
 * blur, or teardown), and the index trails the save, so without this the tab
 * strip and the sidebar "Open" list said "Untitled" while the user was
 * already looking at their typed title. Keyed by graph-relative path; an
 * entry lives only while that note is open and untitled.
 */

let titles: ReadonlyMap<string, string> = new Map()
const listeners = new Set<() => void>()

/** Record (or with `null`, clear) the live title of the note at `path`. */
export function setDraftTitle(path: string, title: string | null): void {
  const current = titles.get(path)
  if (title === null ? current === undefined : current === title) {
    return
  }
  const next = new Map(titles)
  if (title === null) {
    next.delete(path)
  } else {
    next.set(path, title)
  }
  titles = next
  for (const listener of listeners) {
    listener()
  }
}

/** Current snapshot (immutable: a change replaces the map). */
export function draftTitles(): ReadonlyMap<string, string> {
  return titles
}

export function subscribeDraftTitles(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React view of {@link draftTitles}. */
export function useDraftTitles(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribeDraftTitles, draftTitles, draftTitles)
}
