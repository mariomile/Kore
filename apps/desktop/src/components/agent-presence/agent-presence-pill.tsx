import type { ReactElement } from 'react'
import type { AgentPresence } from '@kore/core'
import { BrandMark, PROVIDER_BRANDS } from '@/components/settings/provider-brands'
import { useUndoAgentWrites } from '@/hooks/use-undo-agent-write'
import { useAgentPresence } from '@/lib/agent-presence'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'

/** The brand mark for an agent's name ("Claude Code" → Claude), or the generic plug. */
function agentBrandPath(agent: string): string | null {
  const name = agent.toLowerCase()
  const brand = PROVIDER_BRANDS.find(
    (entry) =>
      entry.path !== null &&
      (name.startsWith(entry.name.toLowerCase()) ||
        (entry.id === 'openai' && name.startsWith('codex'))),
  )
  return brand?.path ?? null
}

/** How a note reads in a sentence: today's daily is "today", else its title or file name. */
function noteLabel(path: string, titles: Readonly<Record<string, string>>): string {
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const day = /^\d{4}-\d{2}-\d{2}$/.exec(file)
  if (day === null) {
    return titles[path] ?? file
  }
  const date = new Date(`${file}T12:00:00`)
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? 'today'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function statusLine(agent: AgentPresence): string {
  if (agent.status === 'writing' && agent.current !== null) {
    return `Writing in ${noteLabel(agent.current, agent.titles)}`
  }
  if (agent.status === 'reading' && agent.current !== null) {
    const others = agent.reading.length - 1
    return others > 0
      ? `Reading ${noteLabel(agent.current, agent.titles)} and ${others} more`
      : `Reading ${noteLabel(agent.current, agent.titles)}`
  }
  const notes = new Set(agent.writes.map((write) => write.path))
  if (notes.size === 1) {
    return `Wrote in ${noteLabel([...notes][0]!, agent.titles)}`
  }
  if (notes.size > 1) {
    return `Wrote in ${notes.size} notes`
  }
  const read = Object.keys(agent.titles).length
  return read === 1 ? 'Read 1 note' : `Read ${read} notes`
}

/**
 * Agents at work in the vault, as one floating pill per agent: its real
 * logo with a live dot while it works, what it is doing in plain words,
 * and Undo for everything it wrote once it stops. Mac floats it at the
 * bottom of the note card, iPhone above the tab bar: same shape, same words.
 */
export function AgentPresencePills({ className }: { className?: string }): ReactElement | null {
  const agents = useAgentPresence()
  const undoWrites = useUndoAgentWrites()
  const mobile = isMobileSurface()
  if (agents.length === 0) {
    return null
  }
  return (
    <div
      className={cn('pointer-events-none flex flex-col items-center gap-2', className)}
      role="status"
      aria-live="polite"
    >
      {agents.map((agent) => {
        const working = agent.status !== 'idle'
        const undoable = !working && agent.writes.some((write) => write.undo !== null)
        return (
          <div
            key={agent.agent}
            data-agent-status={agent.status}
            className={cn(
              'kore-agent-pill pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full bg-surface shadow-lg ring-1 ring-border',
              mobile ? 'h-12 pr-1.5 pl-1.5' : 'h-10 pr-1.5 pl-1.5',
            )}
          >
            <span
              className={cn(
                'relative flex flex-none items-center justify-center rounded-full bg-surface-sunken text-text',
                mobile ? 'size-9' : 'size-7',
              )}
            >
              <BrandMark
                path={agentBrandPath(agent.agent)}
                className={mobile ? 'size-5' : 'size-4'}
              />
              {working ? (
                <span aria-hidden className="kore-agent-live-dot absolute -right-0.5 -bottom-0.5" />
              ) : null}
            </span>
            <span className="flex min-w-0 items-baseline gap-1.5 pr-2 text-[13px]">
              <span className="flex-none font-medium text-text">{agent.agent}</span>
              <span className="truncate text-text-secondary">{statusLine(agent)}</span>
            </span>
            {undoable ? (
              <button
                type="button"
                onClick={() => undoWrites(agent.agent, agent.writes)}
                className={cn(
                  'flex-none rounded-full bg-surface-hover px-3.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-active active:bg-surface-active',
                  mobile
                    ? "relative h-9 after:absolute after:-inset-1.5 after:content-['']"
                    : 'h-7',
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
