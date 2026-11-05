import type { OpenColumn, OpenTab } from '../settings/schema'
import { dailyPath } from './paths'
import { writeWorkspaceState } from './commands'

/**
 * What the app tells external agents (via `.reflect/workspace.json`, read by
 * the `kore` CLI) about the main window: which notes are open and which one
 * the user is looking at. Paths are graph-relative.
 */
export interface WorkspaceNotes {
  activeNote: string | null
  openNotes: string[]
}

const DEBOUNCE_MS = 500

/** The note a tab shows, or null for browser, terminal, graph, settings, tag pages… */
function noteOfTab(tab: OpenTab, today: string): string | null {
  if (tab.kind === 'note') {
    return tab.path
  }
  if (tab.kind === 'surface' && tab.surface === 'daily') {
    return dailyPath(tab.date ?? today)
  }
  return null
}

/** Same identity the tab strip keys on, for the two kinds that are notes. */
function tabKeyOfNote(tab: OpenTab): string | null {
  if (tab.kind === 'note') {
    return `note:${tab.path}`
  }
  return tab.kind === 'surface' && tab.surface === 'daily' ? 'surface:daily' : null
}

/**
 * Note tabs in strip order (pinned first) across panes, deduped, plus the
 * note in the focused pane's active tab.
 */
export function workspaceNotes(
  columns: readonly OpenColumn[],
  activePaneId: string,
  today: string,
): WorkspaceNotes {
  const open = new Set<string>()
  let activeNote: string | null = null
  for (const pane of columns.flatMap((column) => column.panes)) {
    const strip = [
      ...pane.tabs.filter((tab) => tab.pinned),
      ...pane.tabs.filter((tab) => !tab.pinned),
    ]
    for (const tab of strip) {
      const path = noteOfTab(tab, today)
      if (path === null) {
        continue
      }
      open.add(path)
      if (pane.id === activePaneId && pane.activeKey === tabKeyOfNote(tab)) {
        activeNote = path
      }
    }
  }
  return { activeNote, openNotes: [...open] }
}

export function serializeWorkspaceState(notes: WorkspaceNotes, now: Date): string {
  return JSON.stringify({ version: 1, ...notes, updatedAt: now.toISOString() })
}

/**
 * Debounced writer for the workspace state. Unchanged snapshots are dropped,
 * and a write failure is ignored: the file is a best-effort courtesy to
 * external agents and must never disturb the editor.
 */
export function createWorkspaceStatePublisher(generation: number): {
  publish: (notes: WorkspaceNotes) => void
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastKey: string | null = null

  return {
    publish(notes) {
      const key = JSON.stringify(notes)
      if (key === lastKey) {
        return
      }
      lastKey = key
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        writeWorkspaceState(serializeWorkspaceState(notes, new Date()), generation).catch(() => {
          lastKey = null
        })
      }, DEBOUNCE_MS)
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
