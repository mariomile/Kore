import { useCallback } from 'react'
import { errorMessage, type AgentWrite } from '@kore/core'
import { useApplyNoteEdit } from '@/hooks/use-apply-note-edit'
import { agentPresenceStore } from '@/lib/agent-presence'
import { startOperation } from '@/lib/operations'

/**
 * Take back what an agent wrote: apply each write's reverse edit through the
 * same session-or-disk channel as an accepted chat edit (an open note
 * updates in place, unsaved typing intact), newest first, and drop it from
 * the presence picture. A write whose text changed since refuses like a
 * stale chat edit and stays listed.
 */
export function useUndoAgentWrites(): (agent: string, writes: readonly AgentWrite[]) => void {
  const applyNoteEdit = useApplyNoteEdit()
  return useCallback(
    (agent: string, writes: readonly AgentWrite[]) => {
      void (async () => {
        for (const write of [...writes].reverse()) {
          if (write.undo === null) {
            continue
          }
          try {
            await applyNoteEdit(write.path, write.undo)
            agentPresenceStore.dropWrite(agent, write)
          } catch (cause) {
            startOperation(`Undoing ${agent}`).fail(errorMessage(cause))
            return
          }
        }
      })()
    },
    [applyNoteEdit],
  )
}
