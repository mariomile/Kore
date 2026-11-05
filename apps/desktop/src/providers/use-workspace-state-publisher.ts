import { useEffect, useMemo } from 'react'
import { createWorkspaceStatePublisher, workspaceNotes } from '@reflect/core'
import { useToday } from '@/lib/use-today'
import { useGraph } from '@/providers/graph-provider'
import { usePanes } from '@/providers/panes-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * Mirrors the main window's open notes into `.reflect/workspace.json` so
 * external agents (`kore` CLI, `kore mcp`) can see what the user is looking at.
 * Mount once, under the main window's `PanesProvider`.
 */
export function useWorkspaceStatePublisher(): void {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { activePane } = usePanes()
  const today = useToday()
  const root = graph?.root ?? null
  const generation = graph?.generation ?? null
  const columns = root === null ? null : (settings.openTabs[root] ?? [])
  const activePaneId = activePane.id

  const publisher = useMemo(
    () => (generation === null ? null : createWorkspaceStatePublisher(generation)),
    [generation],
  )
  useEffect(() => () => publisher?.cancel(), [publisher])

  useEffect(() => {
    if (publisher !== null && columns !== null) {
      publisher.publish(workspaceNotes(columns, activePaneId, today))
    }
  }, [publisher, columns, activePaneId, today])
}
