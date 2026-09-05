import type { ReactElement } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exportGraphBackup, restoreGraphBackup } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { dirtyOpenPaths, flushOpenDocuments } from '@/editor/open-documents'
import { useAsyncAction } from '@/hooks/use-async-action'
import { exportFileName } from '@/lib/export-file'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'

/** Full graph recovery, distinct from continuous Git file synchronization. */
export function GraphBackupSection(): ReactElement {
  const { graph, openRecent } = useGraph()
  const { settings, updateSettingsWith, whenSettingsLoaded } = useSettings()
  const action = useAsyncAction()
  const available = isNativeShell() && !isMobileSurface()

  const exportBackup = (): void => {
    if (graph === null) return
    void action.run(async () => {
      const path = await save({
        defaultPath: exportFileName(
          `${graph.name}-${new Date().toISOString().slice(0, 10)}`,
          'kore-backup',
          'zip',
        ),
        filters: [{ name: 'Kore graph backup', extensions: ['zip'] }],
      })
      if (path === null) return
      await flushOpenDocuments()
      if (dirtyOpenPaths().length > 0)
        throw new Error(
          'Some notes could not be saved. Resolve their save errors before exporting.',
        )
      await exportGraphBackup(
        path,
        graph.generation,
        settings.agentRoutines.filter((routine) => routine.graphRoot === graph.root),
      )
      toast.add({
        title: 'Graph backup exported',
        description: 'Notes, saved chats, attachments and automations are in the archive.',
      })
    })
  }

  const restoreBackup = (): void => {
    void action.run(async () => {
      if ((await whenSettingsLoaded()) !== 'loaded')
        throw new Error('Settings must load before restoring automations.')
      const archive = await open({
        multiple: false,
        filters: [{ name: 'Kore graph backup', extensions: ['zip'] }],
      })
      if (typeof archive !== 'string') return
      const parent = await open({
        directory: true,
        multiple: false,
        title: 'Choose where to create the restored graph',
      })
      if (typeof parent !== 'string') return
      const restored = await restoreGraphBackup(archive, parent)
      const automations = restored.automations.map((routine) => ({
        ...routine,
        id: crypto.randomUUID(),
        graphRoot: restored.root,
        enabled: false,
        lastRunMs: null,
        retryAtMs: null,
        retryContext: null,
      }))
      updateSettingsWith((current) => ({
        agentRoutines: [...current.agentRoutines, ...automations],
      }))
      if (!(await openRecent(restored.root)))
        throw new Error(`Backup restored to ${restored.root}, but the graph could not be opened.`)
      toast.add({
        title: 'Backup restored as a new graph',
        description: 'Restored automations are paused. Review them in Agents before enabling.',
      })
    })
  }

  return (
    <SettingsField
      legend="Graph archive"
      description="Export notes, saved chats, attachments and this graph’s automations. Restore creates a new graph; existing files stay untouched."
    >
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!available || graph === null || action.pending}
          onClick={exportBackup}
        >
          Export graph backup…
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!available || action.pending}
          onClick={restoreBackup}
        >
          Restore graph backup…
        </Button>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {available
          ? 'Includes private notes. Keep the archive somewhere safe. Provider keys, device settings and Git history are excluded. Finish active chats before exporting.'
          : 'Archive export and restore are available in the Mac app.'}
      </p>
      {action.error !== null ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {action.error}
        </p>
      ) : null}
    </SettingsField>
  )
}
