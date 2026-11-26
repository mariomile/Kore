import { useEffect, useMemo, type ReactElement } from 'react'
import type { AgentPresence } from '@kore/core'
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
export function AgentLiveShading({ path }: { path: string }): ReactElement | null {
  useExtension(useMemo(() => definePlugin(createAgentLivePlugin()), []))
  const agents = useAgentPresence()
  const wrote = agents.some((agent) => agent.writes.some((write) => write.path === path))
  // The marks (and the undo channel they need) mount only once an agent
  // wrote here; until then the plugin holds no marks and costs nothing.
  return wrote ? <Marks path={path} agents={agents} /> : null
}

function Marks({ path, agents }: { path: string; agents: readonly AgentPresence[] }): null {
  const editor = useEditor()
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

  useEffect(() => {
    const cancel = whenEditorMounted(editor, () => setAgentLiveMarks(editor.view, marks))
    return () => {
      cancel()
      if (editor.mounted) {
        setAgentLiveMarks(editor.view, [])
      }
    }
  }, [editor, marks])
  return null
}
