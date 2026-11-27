import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AgentPresence } from '@kore/core'
import { definePlugin } from '@prosekit/core'
import { useEditor, useExtension } from '@meowdown/react'
import { useUndoAgentWrites } from '@/hooks/use-undo-agent-write'
import { useAgentPresence } from '@/lib/agent-presence'
import { createAgentLivePlugin, setAgentLiveMarks, type AgentLiveMark } from './agent-live-plugin'
import { whenEditorMounted } from './when-editor-mounted'

/** How long a write counts as just arrived: its ink motion plays inside this. */
const FRESH_MS = 2_500

/**
 * A NoteEditor child: what outside agents wrote into this note during their
 * sitting, written in live, with the agent's avatar and Undo on its last line.
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
  // The ink motion belongs to writes that just arrived. Once the newest one
  // has had its moment, everything up to it is settled, so a later
  // re-render of the note never replays the motion. Writes from before the
  // note opened count as settled from the start.
  const [settledAt, setSettledAt] = useState(() => Date.now() - FRESH_MS)
  const newest = Math.max(0, ...agents.flatMap((agent) => agent.writes.map((write) => write.atMs)))
  useEffect(() => {
    if (newest <= settledAt) {
      return
    }
    const left = Math.max(0, newest + FRESH_MS - Date.now())
    const timer = setTimeout(() => setSettledAt(newest), left + 50)
    return () => clearTimeout(timer)
  }, [newest, settledAt])

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
        freshLines: writes
          .filter((write) => write.atMs > settledAt)
          .flatMap((write) => write.lines),
        writing: agent.status === 'writing' && agent.current === path,
        onUndo: writes.some((write) => write.undo !== null)
          ? () => undoWrites(agent.agent, writes)
          : null,
      })
    }
    return out
  }, [agents, path, undoWrites, settledAt])

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
