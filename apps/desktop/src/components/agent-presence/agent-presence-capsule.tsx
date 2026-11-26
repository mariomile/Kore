import type { ReactElement } from 'react'
import type { AgentPresence } from '@kore/core'
import { useUndoAgentWrites } from '@/hooks/use-undo-agent-write'
import { useAgentPresence } from '@/lib/agent-presence'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { AgentAvatar } from './agent-avatar'

/** How a note reads in a sentence: today's daily is "today", else its title or file name. */
function noteLabel(path: string, titles: Readonly<Record<string, string>>): string {
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file)) {
    return titles[path] ?? file
  }
  const date = new Date(`${file}T12:00:00`)
  return date.toDateString() === new Date().toDateString()
    ? 'today'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function statusLine(agent: AgentPresence): string {
  const current = agent.current
  if (agent.status === 'writing' && current !== null) {
    return `Writing in ${noteLabel(current, agent.titles)}`
  }
  if (agent.status === 'reading' && current !== null) {
    return `Reading ${noteLabel(current, agent.titles)}`
  }
  const notes = [...new Set(agent.writes.map((write) => write.path))]
  const lines = agent.writes.reduce((sum, write) => sum + write.lines.length, 0)
  if (notes.length === 1) {
    return `Added ${lines === 1 ? 'a line' : `${lines} lines`} to ${noteLabel(notes[0]!, agent.titles)}`
  }
  if (notes.length > 1) {
    return `Added to ${notes.length} notes`
  }
  const read = Object.keys(agent.titles).length
  return read === 1 ? 'Read a note' : `Read ${read} notes`
}

/**
 * Agents at work in the vault, as a capsule per agent: its avatar (the ring
 * turns while it works), one plain sentence that changes as it moves from
 * note to note, and, once it stops, Undo for everything it wrote. The
 * sentence opens the note it is about. On the Mac it sits in the window's
 * tab band like the tabs beside it, on iPhone above the tab bar in the same
 * glass: the chrome speaks, the page stays the user's.
 */
export function AgentPresenceCapsules({ className }: { className?: string }): ReactElement | null {
  const agents = useAgentPresence()
  // Nothing (not even the undo channel, which needs an open vault) mounts
  // until an agent shows up.
  return agents.length === 0 ? null : (
    <Capsules agents={agents} {...(className !== undefined ? { className } : {})} />
  )
}

function Capsules({
  agents,
  className,
}: {
  agents: readonly AgentPresence[]
  className?: string
}): ReactElement {
  const undoWrites = useUndoAgentWrites()
  const { navigate } = useRouter()
  const mobile = isMobileSurface()
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-2', className)}>
      {agents.map((agent) => {
        const working = agent.status !== 'idle'
        const undoable = !working && agent.writes.some((write) => write.undo !== null)
        const target = agent.current ?? agent.writes.at(-1)?.path ?? null
        const line = statusLine(agent)
        return (
          <div
            key={agent.agent}
            data-agent-status={agent.status}
            className={cn(
              'kore-agent-capsule pointer-events-auto flex min-w-0 items-center',
              mobile
                ? 'mobile-nav-capsule h-14 gap-3 p-1.5'
                : 'window-drag-control h-7 gap-2 rounded-full border border-border bg-surface pr-1 pl-0.5 shadow-sm',
            )}
          >
            <AgentAvatar agent={agent.agent} size={mobile ? 'lg' : 'sm'} working={working} />
            <button
              type="button"
              disabled={target === null}
              onClick={() => {
                if (target !== null) {
                  navigate(routeForPath(target))
                }
              }}
              className={cn(
                'flex min-w-0 flex-col items-start text-left',
                mobile ? 'max-w-56' : 'max-w-72 pr-1.5',
              )}
            >
              {mobile ? (
                <span className="text-xs leading-4 font-medium text-text-secondary">
                  {agent.agent}
                </span>
              ) : null}
              {/* Keyed by the sentence so each change enters on its own. */}
              <span
                key={line}
                className={cn(
                  'kore-agent-capsule-line block max-w-full truncate',
                  mobile ? 'text-[15px] leading-5 text-text' : 'text-xs font-medium text-text',
                )}
              >
                {mobile ? line : <AgentLine agent={agent.agent} line={line} />}
              </span>
            </button>
            {undoable ? (
              <button
                type="button"
                onClick={() => undoWrites(agent.agent, agent.writes)}
                className={cn(
                  'flex-none rounded-full font-medium text-text transition-colors duration-150 ease-swift hover:bg-surface-active active:scale-[0.97] active:bg-surface-active motion-reduce:transition-none',
                  mobile
                    ? 'h-11 bg-surface-hover px-4 text-[15px]'
                    : 'h-5 bg-surface-hover px-2.5 text-xs',
                )}
              >
                Undo
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** Mac's one-line form: the agent's name, then what it is doing, quieter. */
function AgentLine({ agent, line }: { agent: string; line: string }): ReactElement {
  return (
    <>
      {agent} <span className="font-normal text-text-secondary">{line}</span>
    </>
  )
}
