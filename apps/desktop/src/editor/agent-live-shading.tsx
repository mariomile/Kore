import { useEffect, useMemo } from 'react'
import { definePlugin } from '@prosekit/core'
import { useEditor, useExtension } from '@meowdown/react'
import { useUndoAgentWrites } from '@/hooks/use-undo-agent-write'
import { useAgentPresence } from '@/lib/agent-presence'
import { createAgentLivePlugin, setAgentLiveMarks, type AgentLiveMark } from './agent-live-plugin'
import { whenEditorMounted } from './when-editor-mounted'

/**
 * A NoteEditor child: what outside agents wrote into this note during their
 * sitting, shaded live, with the agent's flag and Undo on its last line.
 * Mounts its plugin always (a no-op without marks) so a write arriving
 * mid-session needs no remount.
 */
export function AgentLiveShading({ path }: { path: string }): null {
  const editor = useEditor()
  useExtension(useMemo(() => definePlugin(createAgentLivePlugin()), []))
  const agents = useAgentPresence()
  const undoWrites = useUndoAgentWrites()

  const marks = useMemo((): readonly AgentLiveMark[] => {
    const out: AgentLiveMark[] = []
    for (const agent of agents) {
      const writes = agent.writes.filter((write) => write.path === path)
      if (writes.length === 0) {
        continue
      }
      out.push({
        agent: agent.agent,
        lines: writes.flatMap((write) => write.lines),
        writing: agent.status === 'writing' && agent.current === path,
        onUndo: writes.some((write) => write.undo !== null)
          ? () => undoWrites(agent.agent, writes)
          : null,
      })
    }
    return out
  }, [agents, path, undoWrites])

  useEffect(
    () => whenEditorMounted(editor, () => setAgentLiveMarks(editor.view, marks)),
    [editor, marks],
  )
  return null
}
