import { z } from 'zod'
import { agentRoutinesSchema, type AgentRoutine } from '../ai/agent-routines'
import { call } from '../ipc/invoke'

/** Save graph files and a consistent chat database snapshot to a ZIP archive. */
export async function exportGraphBackup(
  archivePath: string,
  generation: number,
  automations: readonly AgentRoutine[],
): Promise<void> {
  await call('graph_backup_export', { archivePath, generation, automations }, z.null())
}

const restoredBackupSchema = z.object({ root: z.string().min(1), automations: agentRoutinesSchema })

/** Restore an archive into a new graph directory, never overwriting existing notes. */
export async function restoreGraphBackup(
  archivePath: string,
  parentPath: string,
): Promise<z.infer<typeof restoredBackupSchema>> {
  return await call('graph_backup_restore', { archivePath, parentPath }, restoredBackupSchema)
}
