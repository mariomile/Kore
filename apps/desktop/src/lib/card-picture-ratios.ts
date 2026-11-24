/**
 * The shapes of the pictures note cards lead with (components/all-notes/
 * note-card-picture.tsx), remembered across launches so a card lays out at
 * its picture's own shape before the thumbnail arrives.
 *
 * A shape is a width-to-height ratio, kept between {@link MIN_PICTURE_RATIO}
 * (a portrait, 4:5) and {@link MAX_PICTURE_RATIO} (a panorama, 2:1): past
 * those a card crops, so one tall photo never fills a column. Kept by the
 * thumbnail's URL. Best-effort: without storage, every launch learns the
 * shapes again.
 */

export const MIN_PICTURE_RATIO = 4 / 5
export const MAX_PICTURE_RATIO = 2

/** The shape a picture gets before its own is known. */
export const DEFAULT_PICTURE_RATIO = 4 / 3

const STORAGE_KEY = 'kore.cardPictureRatios'
const LIMIT = 2000

/**
 * Longest URL kept: an asset URL is short, while an inline `data:` image (the
 * dev bridge's, a pasted one) is the whole picture and would fill storage.
 */
const MAX_KEY_LENGTH = 1024
const SAVE_DELAY_MS = 1000

let ratios: Map<string, number> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function load(): Map<string, number> {
  if (ratios !== null) {
    return ratios
  }
  ratios = new Map()
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'number' &&
          Number.isFinite(entry[1])
        ) {
          ratios.set(entry[0], clampPictureRatio(entry[1]))
        }
      }
    }
  } catch {
    // Unreadable or unavailable storage: start empty.
  }
  return ratios
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
      // Storage is unavailable; the shapes stay for this launch.
    }
  }, SAVE_DELAY_MS)
}

/** A picture's width-to-height ratio, within the shapes a card shows. */
export function clampPictureRatio(ratio: number): number {
  return Math.min(MAX_PICTURE_RATIO, Math.max(MIN_PICTURE_RATIO, ratio))
}

/** The remembered shape of the picture at this URL, if it was ever seen. */
export function rememberedPictureRatio(src: string): number | undefined {
  return load().get(src)
}

/** Remember a picture's shape (already clamped) for the next card that shows it. */
export function rememberPictureRatio(src: string, ratio: number): void {
  if (src.length > MAX_KEY_LENGTH) {
    return
  }
  const map = load()
  if (map.get(src) === ratio) {
    return
  }
  map.delete(src)
  map.set(src, ratio)
  // The oldest go first: a Map iterates in insertion order.
  for (const key of map.keys()) {
    if (map.size <= LIMIT) {
      break
    }
    map.delete(key)
  }
  save()
}
