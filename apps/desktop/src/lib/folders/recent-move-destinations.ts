/**
 * The folders this device last moved something into, newest first: the
 * Move to picker suggests them. A per-device convenience, so it lives in
 * local storage and starts empty wherever storage is unavailable.
 */

const STORAGE_KEY = 'kore.recentMoveDestinations'
const LIMIT = 5

export function recentMoveDestinations(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(stored)
      ? stored.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

export function rememberMoveDestination(folder: string): void {
  if (folder === '') {
    return
  }
  const next = [folder, ...recentMoveDestinations().filter((entry) => entry !== folder)]
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, LIMIT)))
  } catch {
    // Best-effort: without storage the picker simply suggests less.
  }
}
