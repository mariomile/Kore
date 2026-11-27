import { useState, type ReactElement } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import {
  memoryFileChanges,
  undoEpisode,
  type CyberBrainConfig,
  type MemoryEpisodeEntry,
  type MemoryFileChange,
} from '@kore/core'
import { Bot, ExternalLink, Note, Undo } from '@/components/icons'
import { BrandMark, PROVIDER_BRANDS } from '@/components/settings/provider-brands'
import { toast } from '@/components/ui/toast'
import { formatTimeOfDay, formatWeekdayShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * Episodes in the Memory view: one working session of one agent, as the
 * vault's cyber-brain kit wrote it (`brain.mjs episode`). Kore only draws
 * them; Undo runs the kit's own `undo`, so a vault opened in Obsidian or
 * by Claude Code alone reverts the same way.
 */

const KORE_MARK = new URL('../kore-mark.png', import.meta.url).href

/** Brand paths by the agent slugs the kit signs runs with. */
function agentBrandPath(agent: string): string | null {
  const brand = (id: string): string | null =>
    PROVIDER_BRANDS.find((entry) => entry.id === id)?.path ?? null
  if (agent.startsWith('claude')) return brand('claude')
  if (agent === 'codex' || agent.startsWith('chatgpt') || agent.startsWith('openai')) {
    return brand('openai')
  }
  if (agent.startsWith('grok')) return brand('grok')
  if (agent.startsWith('gemini')) return brand('gemini')
  if (agent.startsWith('cursor')) return brand('cursor')
  return null
}

const AGENT_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  claude: 'Claude',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  grok: 'Grok',
  gemini: 'Gemini',
  cursor: 'Cursor',
  kore: 'Kore',
  'kore-chat': 'Kore chat',
}

/** `claude-code` → `Claude Code`; an unknown slug reads as words. */
export function agentName(agent: string): string {
  const known = AGENT_NAMES[agent]
  if (known !== undefined) return known
  const words = agent.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The agent's real logo on a raised tile; a robot for an agent without one. */
export function AgentTile({
  agent,
  size = 'md',
}: {
  agent: string
  size?: 'sm' | 'md'
}): ReactElement {
  const kore = agent.startsWith('kore')
  const path = kore ? null : agentBrandPath(agent)
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center bg-surface text-text shadow-sm',
        size === 'md' ? 'size-9 rounded-xl' : 'size-5 rounded-md',
      )}
    >
      {kore ? (
        <img
          src={KORE_MARK}
          alt=""
          className={cn('w-auto invert dark:invert-0', size === 'md' ? 'h-4.5' : 'h-3')}
        />
      ) : path === null ? (
        <Bot aria-hidden className={size === 'md' ? 'size-4.5' : 'size-3'} />
      ) : (
        <BrandMark path={path} className={size === 'md' ? 'size-4.5' : 'size-3'} />
      )}
    </span>
  )
}

function episodeDate(episode: MemoryEpisodeEntry): Date | null {
  const iso = episode.started ?? episode.ended
  if (iso === null) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `Today`, `Yesterday`, else the weekday and short date. */
function dayLabel(
  date: Date | null,
  dateFormat: Parameters<typeof formatWeekdayShortDate>[1],
): string {
  if (date === null) return 'Earlier'
  const days = differenceInCalendarDays(new Date(), date)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return formatWeekdayShortDate(date, dateFormat)
}

function notesCount(episode: MemoryEpisodeEntry): string {
  const count = episode.touched.length
  return count === 1 ? '1 note' : `${count} notes`
}

interface EpisodeListProps {
  episodes: readonly MemoryEpisodeEntry[]
  selected: string | null
  onSelect: (path: string) => void
  /** iPhone rows: bigger type and touch targets. */
  phone?: boolean
}

/** Episodes grouped by day, newest first, each with its agent's logo. */
export function EpisodeList({
  episodes,
  selected,
  onSelect,
  phone = false,
}: EpisodeListProps): ReactElement {
  const { settings } = useSettings()
  const groups: { label: string; episodes: MemoryEpisodeEntry[] }[] = []
  for (const episode of episodes) {
    const label = dayLabel(episodeDate(episode), settings.dateFormat)
    const last = groups.at(-1)
    if (last?.label === label) last.episodes.push(episode)
    else groups.push({ label, episodes: [episode] })
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className={cn('px-3 font-medium text-text-muted', phone ? 'text-sm' : 'text-xs')}>
            {group.label}
          </h3>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {group.episodes.map((episode) => {
              const date = episodeDate(episode)
              const isSelected = episode.path === selected
              return (
                <li key={episode.path}>
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => onSelect(episode.path)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 text-left transition-colors duration-100',
                      phone ? 'min-h-16 py-2.5 active:bg-surface-hover' : 'min-h-14 py-2',
                      isSelected ? 'bg-surface-active' : 'hover:bg-surface-hover',
                    )}
                  >
                    <AgentTile agent={episode.agent} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-text',
                          phone ? 'text-[17px]' : 'text-sm font-medium',
                        )}
                      >
                        {episode.title}
                      </span>
                      <span
                        className={cn(
                          'block truncate text-text-muted',
                          phone ? 'text-[15px]' : 'text-xs',
                        )}
                      >
                        {agentName(episode.agent)}
                        {date === null ? '' : ` · ${formatTimeOfDay(date, settings.timeFormat)}`}
                        {episode.touched.length > 0 ? ` · ${notesCount(episode)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}

interface EpisodeDetailProps {
  episode: MemoryEpisodeEntry
  config: CyberBrainConfig
  open: (path: string) => void
  /** After the kit undid it: the caller re-reads the memory. */
  onUndone: () => void
  /** Undo needs the kit's Node script, which runs only on the Mac. */
  canUndo: boolean
  phone?: boolean
}

/** One episode: what the agent did, what it learned, and every line it changed. */
export function EpisodeDetail({
  episode,
  config,
  open,
  onUndone,
  canUndo,
  phone = false,
}: EpisodeDetailProps): ReactElement {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const [busy, setBusy] = useState(false)
  const changes = memoryFileChanges(episode.writes)
  const date = episodeDate(episode)
  const pathFor = (name: string): string | null =>
    changes.find((change) => baseName(change.path) === name)?.path ?? null

  async function undo(): Promise<void> {
    if (graph === null) return
    setBusy(true)
    try {
      const result = await undoEpisode(config, episode.path, graph.generation)
      if (result.ok) {
        const kept = /(\d+) write\(s\) left as they were/.exec(result.output)?.[1]
        toast.add({
          type: 'success',
          title: 'Episode undone',
          description:
            kept === undefined
              ? 'Its lines are out of your notes and kept in the archive.'
              : `${kept} line${kept === '1' ? '' : 's'} changed since were left as they are.`,
        })
        onUndone()
      } else {
        toast.add({
          type: 'error',
          title: 'Couldn’t undo the episode',
          description: result.error,
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const actions = (
    <div className="flex flex-none items-center gap-2">
      {phone ? null : (
        <PillButton onClick={() => open(episode.path)} icon={<ExternalLink aria-hidden />}>
          Open note
        </PillButton>
      )}
      {canUndo ? (
        <PillButton onClick={() => void undo()} disabled={busy} icon={<Undo aria-hidden />}>
          {busy ? 'Undoing…' : 'Undo'}
        </PillButton>
      ) : null}
    </div>
  )

  return (
    <article aria-label={episode.title} className="flex min-w-0 flex-col">
      {phone ? <div className="flex justify-end">{actions}</div> : null}
      <div className="flex items-start gap-4">
        <h2
          className={cn(
            'min-w-0 flex-1 font-semibold text-text',
            phone ? 'mt-2 text-[28px] leading-tight tracking-tight' : 'text-xl leading-snug',
          )}
        >
          {episode.title}
        </h2>
        {phone ? null : actions}
      </div>
      <p
        className={cn(
          'mt-1.5 flex flex-wrap items-center gap-x-1.5 text-text-muted',
          phone ? 'text-[15px]' : 'text-[13px]',
        )}
      >
        <span className="flex items-center gap-1.5">
          <AgentTile agent={episode.agent} size="sm" />
          {agentName(episode.agent)}
        </span>
        {date === null ? null : (
          <span>
            · {dayLabel(date, settings.dateFormat)} {formatTimeOfDay(date, settings.timeFormat)}
          </span>
        )}
        {episode.durationMin !== null && episode.durationMin > 0 ? (
          <span>· {episode.durationMin} min</span>
        ) : null}
      </p>
      {episode.summary === '' ? null : (
        <p
          className={cn(
            'mt-4 whitespace-pre-wrap text-text',
            phone ? 'text-[17px] leading-relaxed' : 'text-[15px] leading-relaxed',
          )}
        >
          {episode.summary}
        </p>
      )}

      {episode.learned.length > 0 ? (
        <section aria-label="What it learned" className="mt-7">
          <h3 className="text-xs font-medium text-text-muted">What it learned</h3>
          <ul className="mt-2 flex flex-col gap-4">
            {episode.learned.map((fact) => {
              const target = fact.note === null ? null : pathFor(fact.note)
              return (
                <li key={fact.text} className="flex flex-col items-start gap-1.5">
                  <span className={cn('min-w-0 text-text', phone ? 'text-[17px]' : 'text-sm')}>
                    {fact.text}
                  </span>
                  {fact.note !== null ? (
                    <NoteChip
                      label={fact.note}
                      onClick={target === null ? undefined : () => open(target)}
                    />
                  ) : (
                    <span className="flex-none text-xs text-text-muted">
                      {fact.queued ? 'Waiting for the nightly dream' : 'No note yet'}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {changes.length > 0 ? (
        <section aria-label="Changes" className="mt-7">
          <h3 className="text-xs font-medium text-text-muted">Changes</h3>
          <div className="mt-2 flex flex-col gap-2">
            {changes.map((change) => (
              <FileChange key={change.path} change={change} open={open} />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  )
}

function PillButton({
  onClick,
  disabled = false,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  icon: ReactElement
  children: string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 min-w-11 items-center gap-1.5 rounded-full bg-surface-hover px-3.5 text-[13px] font-medium text-text transition-all duration-150 ease-swift hover:bg-surface-active active:scale-[0.97] disabled:opacity-50 [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </button>
  )
}

function NoteChip({
  label,
  onClick,
}: {
  label: string
  onClick: (() => void) | undefined
}): ReactElement {
  const className =
    'flex h-7 max-w-56 flex-none items-center gap-1.5 rounded-full bg-surface-hover px-2.5 text-xs text-text-secondary [&_svg]:size-3.5'
  if (onClick === undefined) {
    return (
      <span className={className}>
        <Note aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        'transition-colors duration-100 hover:bg-surface-active hover:text-text',
      )}
    >
      <Note aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  )
}

function FileChange({
  change,
  open,
}: {
  change: MemoryFileChange
  open: (path: string) => void
}): ReactElement {
  return (
    <div className="rounded-xl bg-surface-sunken p-2">
      <div className="flex items-center gap-2 px-1.5 py-1">
        <button
          type="button"
          onClick={() => open(change.path)}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-text underline-offset-2 hover:underline"
          title={change.path}
        >
          {change.path}
        </button>
        <span className="flex-none text-xs font-medium tabular-nums">
          {change.added > 0 ? <span className="text-success">+{change.added}</span> : null}
          {change.removed > 0 ? (
            <span className="ml-1.5 text-danger">−{change.removed}</span>
          ) : null}
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {change.lines.map((line, index) => (
          <li
            key={`${index}-${line.text}`}
            className={cn(
              'flex gap-2 rounded-lg px-2 py-1 text-[13px] leading-snug',
              line.sign === '+'
                ? 'bg-success-soft text-text'
                : 'bg-danger-soft text-text-secondary',
            )}
          >
            <span
              aria-label={line.sign === '+' ? 'added' : 'removed'}
              className={cn(
                'flex-none font-medium',
                line.sign === '+' ? 'text-success' : 'text-danger',
              )}
            >
              {line.sign === '+' ? '+' : '−'}
            </span>
            <span className={cn('min-w-0 break-words', line.sign === '-' && 'line-through')}>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
