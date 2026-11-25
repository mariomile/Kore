import { setLinkPreviewStore, type StoredLinkPreview } from '@kore/core'

/**
 * The device's link preview store (core's `setLinkPreviewStore`): previews
 * kept in local storage, so a note opened after a relaunch draws its link
 * cards at once instead of fetching every page again. Core validates each
 * entry and decides how long it stays fresh; this only keeps the newest
 * {@link LIMIT} by URL. Best-effort, like the card picture shapes: without
 * storage, every launch fetches again.
 */

const STORAGE_KEY = 'kore.linkPreviews'
const LIMIT = 500
/** A pasted `data:` or tracking-laden URL long enough to bloat storage is not kept. */
const MAX_KEY_LENGTH = 2048
const SAVE_DELAY_MS = 1000

let entries: Map<string, unknown> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function load(): Map<string, unknown> {
  if (entries !== null) {
    return entries
  }
  entries = new Map()
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (Array.isArray(entry) && typeof entry[0] === 'string') {
          entries.set(entry[0], entry[1])
        }
      }
    }
  } catch {
    // Unreadable or unavailable storage: start empty.
  }
  return entries
}

function save(): void {
  if (saveTimer !== null) {
    return
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...load()]))
    } catch {
      // Storage is full or unavailable; the previews stay for this launch.
    }
  }, SAVE_DELAY_MS)
}

function write(url: string, entry: StoredLinkPreview): void {
  if (url.length > MAX_KEY_LENGTH) {
    return
  }
  const kept = load()
  // Re-inserted last, so the oldest entries are the ones trimmed.
  kept.delete(url)
  kept.set(url, entry)
  for (const oldest of kept.keys()) {
    if (kept.size <= LIMIT) {
      break
    }
    kept.delete(oldest)
  }
  save()
}

/** Install the store; call once at startup. */
export function installLinkPreviewStore(): void {
  setLinkPreviewStore({ read: (url) => load().get(url) ?? null, write })
}
