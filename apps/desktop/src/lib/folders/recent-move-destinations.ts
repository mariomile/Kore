/**
 * The folders this device last moved something into, per vault, newest
 * first: the Move to picker suggests the ones that still exist. A per-device
 * convenience, so it lives in local storage and starts empty wherever storage
 * is unavailable.
 */

const STORAGE_KEY = 'kore.recentMoveDestinations'
const LIMIT = 5

type RecentByVault = Record<string, string[]>

function load(): RecentByVault {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as RecentByVault)
      : {}
  } catch {
    return {}
  }
}

/** The vault's latest destinations, newest first. */
export function recentMoveDestinations(vault: string): string[] {
  const entries = load()[vault]
  return Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : []
}

export function rememberMoveDestination(vault: string, folder: string): void {
  if (folder === '') {
    return
  }
  const all = load()
  all[vault] = [folder, ...recentMoveDestinations(vault).filter((entry) => entry !== folder)].slice(
    0,
    LIMIT,
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Best-effort: without storage the picker simply suggests less.
  }
}
