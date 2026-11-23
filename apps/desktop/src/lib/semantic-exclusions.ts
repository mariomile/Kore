import { useSyncExternalStore } from 'react'
import {
  errorMessage,
  normalizeExcludedFolders,
  readVaultSettings,
  semanticExcludedFolders,
  withSemanticExcludedFolders,
  writeVaultSettings,
} from '@kore/core'
import { startOperation } from '@/lib/operations'

/**
 * The open vault's folders kept out of the semantic index
 * (`semantic.excludeFolders` in its `.kore.json`), held outside React because
 * the embedding sync, the manual rebuild and the settings field all read it.
 * `null` until the vault's file has been read: the embedding sync waits for
 * it, so a launch never embeds a folder the vault excludes.
 *
 * Read once per vault open. A list another device changes arrives with the
 * next open, which is also when its backfill would act on it.
 */
let current: readonly string[] | null = null
const listeners = new Set<() => void>()

function publish(next: readonly string[] | null): void {
  current = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The open vault's excluded folders, or `null` while they are unread. */
export function getSemanticExclusions(): readonly string[] | null {
  return current
}

/** {@link getSemanticExclusions}, re-rendering when the list changes. */
export function useSemanticExclusions(): readonly string[] | null {
  return useSyncExternalStore(subscribe, getSemanticExclusions)
}

/** Forget the list (the vault is closing); readers see "unread" again. */
export function clearSemanticExclusions(): void {
  publish(null)
}

/**
 * Read the open vault's list. An unreadable file reads as no exclusions: the
 * embeddings it would have kept out are dropped again once it is fixed, which
 * is cheaper than leaving semantic search off until then.
 */
export async function loadSemanticExclusions(
  generation: number,
  isStale: () => boolean,
): Promise<void> {
  let folders: string[]
  try {
    folders = semanticExcludedFolders(await readVaultSettings(generation))
  } catch (cause) {
    console.error('reading the semantic exclusions failed; excluding nothing:', cause)
    folders = []
  }
  if (!isStale()) {
    publish(folders)
  }
}

/** Writes queue up, so two quick edits land in the order they were made. */
let writes: Promise<void> = Promise.resolve()

/**
 * Replace the open vault's list: shown at once, then written into the vault
 * file against its current contents so another device's unrelated change
 * survives. A failed write says so and puts the previous list back, unless a
 * later edit has already replaced what this one showed.
 */
export function saveSemanticExclusions(
  folders: readonly string[],
  generation: number,
): Promise<void> {
  const previous = current
  const shown = normalizeExcludedFolders(folders)
  publish(shown)
  writes = writes.then(async () => {
    try {
      const next = withSemanticExcludedFolders(await readVaultSettings(generation), shown)
      await writeVaultSettings(next, generation)
    } catch (cause) {
      if (current === shown) {
        publish(previous)
      }
      startOperation('Saving search settings').fail(errorMessage(cause))
    }
  })
  return writes
}
