import { useSyncExternalStore } from 'react'
import type { Icon } from '@/components/icons/create-icon'

/** Stored symbol name → icon, in manifest (picker) order. */
export type TagSymbolIcons = Readonly<Record<string, Icon>>

// The generated table is ~180 KB of SVG paths, and only notes and tags that
// picked a symbol draw from it. Imported statically it sat on the boot path
// of every launch, so it loads on first use instead and every reader
// re-renders once it lands.
let loaded: TagSymbolIcons | null = null
let pending: Promise<TagSymbolIcons> | null = null
const listeners = new Set<() => void>()

/**
 * Start (or join) the one fetch of the symbol table. Resolves with the table;
 * readers that only render should use {@link useTagSymbolIcons} instead.
 */
export function loadTagSymbolIcons(): Promise<TagSymbolIcons> {
  pending ??= import('./tag-symbol-icons.gen').then((module) => {
    loaded = module.TAG_SYMBOL_ICONS
    for (const listener of listeners) {
      listener()
    }
    return loaded
  })
  return pending
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  void loadTagSymbolIcons()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): TagSymbolIcons | null {
  return loaded
}

/** The symbol table, or null on the frames before its chunk has loaded. */
export function useTagSymbolIcons(): TagSymbolIcons | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}
