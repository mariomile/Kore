/**
 * In-memory markdown for recently read notes, keyed by graph-relative path —
 * the warm half of opening a note (notes must open without a visible loading
 * beat).
 *
 * `useNoteDocument` serves a session's *first* read from here when it can, so
 * reopening a note (a tab switch, back navigation, a revisited day) renders
 * the editor without waiting on IPC — and, for an iCloud-evicted file,
 * without blocking on the on-demand download `note_read` performs. A warm
 * open is optimistic by design: the pane immediately re-reads the file
 * through the ordinary external-change reconciliation, so stale content
 * self-heals under the same contract as any external edit (a clean buffer
 * adopts the disk content silently; a dirty one parks it as a conflict).
 *
 * The cache serves only while `useNoteContentCache` is mounted — that hook
 * owns invalidation (watcher events) and clears everything when its graph
 * closes or switches. Unmounted (tests, surfaces that don't opt in), every
 * lookup misses and the open path behaves exactly as before.
 */

/** Entries beyond this are dropped oldest-first. */
const MAX_ENTRIES = 64

/**
 * Contents above this size are never cached: a note this large pays its open
 * cost in parsing and editor mount, not the read, and one pathological file
 * must not pin megabytes of markdown here.
 */
const MAX_CONTENT_LENGTH = 512 * 1024

/** Mounted-lifecycle refcount; the cache only serves (or fills) above zero. */
let enabled = 0

/** Insertion order is recency: reads and writes re-append their entry. */
const entries = new Map<string, string>()

/**
 * Switch the cache on for a mounted maintenance lifecycle; the returned
 * disposer switches it back off. Refcounted for effect double-invocation;
 * the last disposer clears the entries so nothing outlives its graph.
 */
export function enableNoteContentCache(): () => void {
  enabled += 1
  let disposed = false
  return () => {
    if (disposed) {
      return
    }
    disposed = true
    enabled -= 1
    if (enabled === 0) {
      entries.clear()
    }
  }
}

/** The cached markdown for `path`, refreshing its recency; miss when off. */
export function getCachedNoteContent(path: string): string | undefined {
  if (enabled === 0) {
    return undefined
  }
  const content = entries.get(path)
  if (content !== undefined) {
    entries.delete(path)
    entries.set(path, content)
  }
  return content
}

/** Record `path`'s markdown as read from (or written to) disk just now. */
export function cacheNoteContent(path: string, content: string): void {
  if (enabled === 0 || content.length > MAX_CONTENT_LENGTH) {
    return
  }
  entries.delete(path)
  entries.set(path, content)
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) {
      entries.delete(oldest)
    }
  }
}

/** Drop `path` (an external change landed; the next open re-reads disk). */
export function invalidateCachedNote(path: string): void {
  entries.delete(path)
}
