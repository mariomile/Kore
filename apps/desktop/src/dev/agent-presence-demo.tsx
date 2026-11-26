import { useEffect } from 'react'
import { useApplyNoteEdit } from '@/hooks/use-apply-note-edit'
import { agentPresenceStore } from '@/lib/agent-presence'

/**
 * Dev harness only (`?agentDemo`): scripts what the live channel will say
 * when Claude Code works in the vault through `kore mcp`: it reads the
 * launch note and Sarah's, writes two lines into today's note, then stops.
 * The writes go through the real edit channel, so the open daily updates
 * in place exactly as an outside write would. `?agentDemo=writing` stops
 * mid-write, to look at the caret.
 */
const AGENT = 'Claude Code'

function isoToday(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function AgentPresenceDemo(): null {
  const applyNoteEdit = useApplyNoteEdit()
  useEffect(() => {
    const stopAt = new URLSearchParams(window.location.search).get('agentDemo')
    const daily = `daily/${isoToday()}.md`
    const lines = [
      '- Open after the [[Kore V2]] review: confirm the launch date with [[Sarah Chen]]',
      '+ [ ] Send Sarah the beta feedback summary before Friday',
    ]
    const read = (path: string, title: string): void =>
      agentPresenceStore.apply({ agent: AGENT, kind: 'read', path, title, atMs: Date.now() })
    const write = (line: string): void => {
      const newText = `${line}\n`
      void applyNoteEdit(daily, { oldText: '', newText }).then(() =>
        agentPresenceStore.apply({
          agent: AGENT,
          kind: 'write',
          path: daily,
          lines: [line],
          undo: { oldText: newText, newText: '' },
          atMs: Date.now(),
        }),
      )
    }
    const script: [number, () => void][] = [
      [1500, () => read('notes/reflect-v2.md', 'Kore V2')],
      [3200, () => read('notes/sarah-chen.md', 'Sarah Chen')],
      [4800, () => read(daily, 'Today')],
      [6200, () => write(lines[0]!)],
      [7600, () => write(lines[1]!)],
    ]
    if (stopAt !== 'writing') {
      script.push([
        9400,
        () => agentPresenceStore.apply({ agent: AGENT, kind: 'done', atMs: Date.now() }),
      ])
    }
    const startedAt = Date.now()
    let next = 0
    const clock = setInterval(() => {
      while (next < script.length && Date.now() - startedAt >= script[next]![0]) {
        script[next]![1]()
        next += 1
      }
      if (next === script.length) {
        clearInterval(clock)
      }
    }, 100)
    return () => clearInterval(clock)
  }, [applyNoteEdit])
  return null
}
