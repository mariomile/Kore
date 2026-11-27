import { useState, type ReactElement, type ReactNode } from 'react'
import {
  checkMemoryHealth,
  type CyberBrainConfig,
  type MemoryHealth,
  type MemoryOverview,
} from '@kore/core'
import { EpisodeDetail, EpisodeList } from '@/components/memory/memory-episodes'
import { useCyberBrainConfig, useMemoryOverview } from '@/components/memory/use-memory'
import {
  MemoryPromptsDialog,
  type MemoryPromptTab,
} from '@/components/memory/memory-prompts-dialog'
import { Bot } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageLoading } from '@/components/page-loading'
import { EmptyState } from '@/components/ui/empty-state'
import { PageBody, PageHeader } from '@/components/ui/page-header'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { cn } from '@/lib/utils'

/**
 * The Memory view (Plan 35, slice 3): what a cyber-brain vault remembers,
 * read from the kit's own files. Episodes first (one note per agent working
 * session, with the lines it changed and an Undo through the kit), then the
 * overview: NOW, the open loops, the decisions, and the run records of every
 * agent that wrote memory, Kore's chat included.
 * Every row opens the file it came from, so a wrong memory is fixed where
 * it lives. The health check runs the kit's own `check`.
 */
export function MemoryScreen(): ReactElement {
  const { data: config, isPending } = useCyberBrainConfig()
  if (isPending) {
    return <PageLoading label="Loading memory" className="h-full" />
  }
  if (config == null) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-auto">
        <PageHeader title="Memory" />
        <EmptyState
          icon={Bot}
          title="Memory isn’t set up in this vault"
          description="What your agents remember, decide and leave open shows here once the vault’s AGENTS.md sets up a memory contract."
          className="my-auto"
        />
      </div>
    )
  }
  return <MemoryOverviewView config={config} />
}

function MemoryOverviewView({ config }: { config: CyberBrainConfig }): ReactElement {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const [promptDialog, setPromptDialog] = useState<{
    open: boolean
    tab: MemoryPromptTab
  }>({
    open: false,
    tab: 'import',
  })
  const [view, setView] = useState<MemoryView | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isError, refresh } = useMemoryOverview(config)
  const open = (path: string): void => navigate(routeForPath(path))

  if (isError) {
    return (
      <p role="alert" className="px-6 py-8 text-sm text-text-muted">
        Couldn’t read the memory files.
      </p>
    )
  }
  if (data === undefined) {
    return <PageLoading label="Loading memory" className="h-full" />
  }
  const shown: MemoryView = view ?? (data.episodes.length > 0 ? 'episodes' : 'overview')
  const episode = data.episodes.find((entry) => entry.path === selected) ?? data.episodes[0] ?? null
  return (
    <>
      <PageHeader
        title="Memory"
        description={`What your agents did and learned, written as notes in this vault · cyber-brain ${config.version}`}
      >
        <MemoryViewTabs view={shown} episodes={data.episodes.length} onSelect={setView} />
        <Button
          size="xs"
          variant="outline"
          onClick={() => setPromptDialog({ open: true, tab: 'import' })}
        >
          Import memories
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setPromptDialog({ open: true, tab: 'instructions' })}
        >
          Agent instructions
        </Button>
      </PageHeader>
      {shown === 'episodes' ? (
        <div className="grid max-w-6xl grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] items-start gap-6 pr-7 pb-10 pl-9">
          {data.episodes.length === 0 || episode === null ? (
            <EmptyState
              icon={Bot}
              title="No episodes yet"
              description={
                Number.parseFloat(config.version) < 0.3
                  ? 'Agents write one episode per working session from cyber-brain 0.3. Update the vault’s kit to start.'
                  : 'Each agent writes one at the end of a working session: what it did, what it learned, and every line it changed.'
              }
              className="col-span-2 my-16"
            />
          ) : (
            <>
              <EpisodeList
                episodes={data.episodes}
                selected={episode.path}
                onSelect={setSelected}
              />
              <div className="sticky top-4 min-w-0 pt-2 pl-4">
                <EpisodeDetail
                  key={episode.path}
                  episode={episode}
                  config={config}
                  open={open}
                  canUndo={episode.path.startsWith(`${config.systemPath}/`)}
                  onUndone={() => {
                    setSelected(null)
                    refresh()
                  }}
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <PageBody>
          {data.userPath !== null || data.soulPath !== null ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
              {data.userPath !== null ? (
                <button
                  type="button"
                  onClick={() => open(data.userPath!)}
                  className="underline-offset-2 hover:text-text hover:underline"
                >
                  Open USER.md
                </button>
              ) : null}
              {data.soulPath !== null ? (
                <button
                  type="button"
                  onClick={() => open(data.soulPath!)}
                  className="underline-offset-2 hover:text-text hover:underline"
                >
                  Open SOUL.md
                </button>
              ) : null}
            </div>
          ) : null}
          <NowSection data={data} open={open} />
          {data.transit.length > 0 ? <TransitSection data={data} open={open} /> : null}
          <LoopsSection data={data} open={open} />
          <DecisionsSection data={data} open={open} />
          {data.exclusions.length > 0 ? <ExclusionsSection data={data} open={open} /> : null}
          <RunsSection data={data} open={open} />
          <HealthSection config={config} />
          <MemoryPromptsDialog
            open={promptDialog.open}
            tab={promptDialog.tab}
            onTabChange={(tab) => setPromptDialog((prev) => ({ ...prev, tab }))}
            onOpenChange={(isOpen) => setPromptDialog((prev) => ({ ...prev, open: isOpen }))}
            vaultName={graph?.name ?? 'Kore'}
            systemPath={config.systemPath}
          />
        </PageBody>
      )}
    </>
  )
}

type MemoryView = 'episodes' | 'overview'

/** Episodes / Overview, the same segmented pill as the Tasks views. */
function MemoryViewTabs({
  view,
  episodes,
  onSelect,
}: {
  view: MemoryView
  episodes: number
  onSelect: (view: MemoryView) => void
}): ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Memory views"
      className="flex flex-none items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
    >
      {(['episodes', 'overview'] as const).map((entry) => {
        const selected = entry === view
        return (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(entry)}
            className={cn(
              'flex h-6 flex-none items-baseline gap-1.5 rounded-full px-2.5 text-[13px] leading-6 font-medium transition-colors duration-100',
              selected
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {entry === 'episodes' ? 'Episodes' : 'Overview'}
            {entry === 'episodes' ? (
              <span className="text-xs font-normal tabular-nums text-text-muted">{episodes}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

interface SectionProps {
  data: MemoryOverview
  open: (path: string) => void
}

function Section({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section aria-label={label} className="mt-10">
      <h2 className="text-2xs font-medium tracking-wide text-text-muted">{label}</h2>
      {children}
    </section>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-surface-hover"
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: ReactNode }): ReactElement {
  return <p className="mt-2 px-2.5 text-sm text-text-muted">{children}</p>
}

function NowSection({ data, open }: SectionProps): ReactElement {
  return (
    <Section label="Now">
      {data.now === null ? (
        <Empty>NOW.md is empty.</Empty>
      ) : (
        <Row onClick={() => open(data.now!.path)}>
          <span className="line-clamp-6 whitespace-pre-wrap text-sm text-text">
            {data.now.body}
          </span>
        </Row>
      )}
    </Section>
  )
}

function TransitSection({ data, open }: SectionProps): ReactElement {
  return (
    <Section label={`In transit (${data.transit.length})`}>
      <ul className="mt-2 flex flex-col">
        {data.transit.slice(0, 20).map((entry, index) => (
          <li key={`${entry.path}-${index}`}>
            <Row onClick={() => open(entry.path)}>
              <Badge variant="secondary" className="mt-0.5 shrink-0">
                {entry.kind}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{entry.text}</span>
                <span className="block truncate text-xs text-text-muted">
                  {entry.agent}
                  {entry.target !== '?' ? ` → ${entry.target}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-muted">
                {entry.since ?? ''}
              </span>
            </Row>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function ExclusionsSection({ data, open }: SectionProps): ReactElement {
  return (
    <Section label={`Exclusions (${data.exclusions.length})`}>
      <ul className="mt-2 flex flex-col">
        {data.exclusions.map((exclusion) => (
          <li key={exclusion.topic}>
            <Row onClick={() => open(data.exclusionsPath)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{exclusion.topic}</span>
                {exclusion.reason !== null ? (
                  <span className="block truncate text-xs text-text-muted">{exclusion.reason}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-muted">
                {exclusion.since ?? ''}
              </span>
            </Row>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function LoopsSection({ data, open }: SectionProps): ReactElement {
  return (
    <Section label={`Open loops (${data.openLoops.length})`}>
      {data.openLoops.length === 0 ? (
        <Empty>No open loops.</Empty>
      ) : (
        <ul className="mt-2 flex flex-col">
          {data.openLoops.map((loop) => (
            <li key={loop.id}>
              <Row onClick={() => open(data.loopsPath)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{loop.title}</span>
                  {loop.state !== null && loop.state !== 'open' ? (
                    <span className="block truncate text-xs text-text-muted">{loop.state}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-text-muted">
                  {loop.status === 'waiting-user' ? 'waiting on you · ' : ''}
                  {loop.owner !== null && loop.owner !== 'user' ? `${loop.owner} · ` : ''}
                  {loop.resurface ?? loop.opened ?? ''}
                </span>
              </Row>
            </li>
          ))}
        </ul>
      )}
      {data.closedLoops > 0 ? (
        <p className="mt-1 px-2.5 text-xs text-text-muted">
          {data.closedLoops} closed, not archived yet
        </p>
      ) : null}
    </Section>
  )
}

function DecisionsSection({ data, open }: SectionProps): ReactElement {
  return (
    <Section label={`Decisions (${data.decisions.length})`}>
      {data.decisions.length === 0 ? (
        <Empty>No decisions recorded.</Empty>
      ) : (
        <ul className="mt-2 flex flex-col">
          {data.decisions.slice(0, 20).map((decision) => (
            <li key={decision.path}>
              <Row onClick={() => open(decision.path)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{decision.title}</span>
                  {decision.description !== '' ? (
                    <span className="block truncate text-xs text-text-muted">
                      {decision.description}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {decision.date ?? ''}
                </span>
              </Row>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function RunsSection({ data, open }: SectionProps): ReactElement {
  return (
    <Section label="Recent memory writes">
      {data.runs.length === 0 ? (
        <Empty>No agent has written memory yet.</Empty>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {data.runs.map((run) => (
            <li key={`${run.at}-${run.agent}-${run.summary}`} className="rounded-md px-2.5 py-1.5">
              <div className="flex items-baseline gap-2 text-xs text-text-muted">
                <span className="font-medium text-text-secondary">{run.agent}</span>
                <span>{run.skill}</span>
                <span className="ml-auto tabular-nums">
                  {run.at.slice(0, 16).replace('T', ' ')}
                  {run.commit === null ? '' : ` · ${run.commit.slice(0, 7)}`}
                </span>
              </div>
              <p className="text-sm text-text">{run.summary}</p>
              {run.writes.length > 0 ? (
                <div className="mt-0.5 flex flex-wrap gap-x-2">
                  {run.writes.map((write) => (
                    <button
                      key={`${write.path}-${write.after}`}
                      type="button"
                      onClick={() => open(write.path)}
                      title={write.after}
                      className="truncate font-mono text-2xs text-text-muted underline-offset-2 hover:text-text hover:underline"
                    >
                      {write.path}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function HealthSection({ config }: { config: CyberBrainConfig }): ReactElement {
  const { graph } = useGraph()
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<MemoryHealth | null>(null)
  async function run(): Promise<void> {
    if (graph === null) return
    setBusy(true)
    try {
      setHealth(await checkMemoryHealth(config, graph.generation))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section label="Health">
      <div className="mt-2 flex flex-col items-start gap-2 px-2.5 text-sm">
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void run()}>
          {busy ? 'Checking…' : 'Run the memory check'}
        </Button>
        {health === null ? null : !health.ok ? (
          <p role="alert" className="text-xs text-destructive">
            {health.error}
          </p>
        ) : health.issues.length === 0 ? (
          <p className="text-xs text-text-secondary">No issues.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-xs">
            {health.issues.map((issue, index) => (
              <li
                key={index}
                className={issue.level === 'error' ? 'text-destructive' : 'text-text-secondary'}
              >
                {issue.level}: {issue.where} — {issue.msg}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}
