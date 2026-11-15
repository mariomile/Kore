import { useSyncExternalStore } from 'react'
import type { FormattingBlockKind } from './formatting-toolbar-store'

/** When a reminder lands, as the action bar offers it. */
export type BlockReminder = 'today' | 'tomorrow' | 'nextWeek'

/** What the selected blocks allow, recomputed on every selection change. */
export interface BlockSelectionState {
  count: number
  /** The shared block kind, or `null` when the selection mixes kinds. */
  kind: FormattingBlockKind | null
  canIndent: boolean
  canOutdent: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}

/** The action bar's verbs, each closing over the editor that owns the selection. */
export interface BlockSelectionCommands {
  setKind: (kind: FormattingBlockKind) => void
  /** A preset, or a day picked on the calendar. */
  remind: (when: BlockReminder | Date) => void
  indent: () => void
  outdent: () => void
  moveUp: () => void
  moveDown: () => void
  duplicate: () => void
  copy: () => Promise<void>
  remove: () => void
  /** Zoom into the first selected block. */
  zoom: () => void
  /** Move the first selected block (with its children) to another note. */
  /** Lift the one selected block into a note of its own, leaving a page card. */
  makePage: () => void
  moveToNote: () => void
  /** Select the blocks' text and open the AI menu on it. */
  askAi: () => void
  clear: () => void
}

export interface BlockSelection {
  state: BlockSelectionState
  commands: BlockSelectionCommands
}

/**
 * Module-scope store for "the editor with selected blocks" (the same shape as
 * the formatting toolbar's store). The daily carousel keeps several editors
 * mounted, so ownership is per editor; a new selection in one editor replaces
 * the other's in the bar.
 */
let active: BlockSelection | null = null
let activeOwner: symbol | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function publishBlockSelection(owner: symbol, selection: BlockSelection): void {
  // One selection at a time across the carousel's editors.
  if (activeOwner !== null && activeOwner !== owner) active?.commands.clear()
  activeOwner = owner
  active = selection
  notify()
}

export function clearBlockSelection(owner: symbol): void {
  if (activeOwner !== owner) return
  activeOwner = null
  active = null
  notify()
}

/** The owner currently publishing, so another editor can drop its selection. */
export function blockSelectionOwner(): symbol | null {
  return activeOwner
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBlockSelection(): BlockSelection | null {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  )
}
