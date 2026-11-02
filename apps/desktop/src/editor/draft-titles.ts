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
/** Who published each entry: only that owner may clear it. */
const owners = new Map<string, object>()
const listeners = new Set<() => void>()

function publish(next: Map<string, string>): void {
  titles = next
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Record the live title of the note at `path` on behalf of `owner` (one
 * rename coordinator); `null` clears it. The latest writer owns the entry.
 */
export function setDraftTitle(path: string, title: string | null, owner: object): void {
  if (title === null) {
    clearDraftTitle(path, owner)
    return
  }
  owners.set(path, owner)
  if (titles.get(path) === title) {
    return
  }
  publish(new Map(titles).set(path, title))
}

/**
 * Drop `path`'s entry, but only while `owner` still holds it: an outgoing
 * coordinator's late teardown (StrictMode remount, a recreated session on
 * the same path) must not wipe the title its successor just published.
 */
export function clearDraftTitle(path: string, owner: object): void {
  if (owners.get(path) !== owner) {
    return
  }
  owners.delete(path)
  const next = new Map(titles)
  next.delete(path)
  publish(next)
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
