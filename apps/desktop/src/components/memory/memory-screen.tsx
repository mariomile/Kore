import { useState, type ReactElement, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  checkMemoryHealth,
  loadCyberBrainConfig,
  loadMemoryOverview,
  type CyberBrainConfig,
  type MemoryHealth,
  type MemoryOverview,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * The Memory view (Plan 35, slice 3): what a cyber-brain vault remembers,
 * read from the kit's own files — NOW, the open loops, the decisions, and
 * the run records of every agent that wrote memory, Kore's chat included.
 * Every row opens the file it came from, so a wrong memory is fixed where
 * it lives. The health check runs the kit's own `check`.
 */
export function MemoryScreen(): ReactElement {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data: config, isPending } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'cyber-brain-config'],
    queryFn: () => loadCyberBrainConfig(),
    enabled: bridgeReady && graph !== null,
  })
  if (isPending) {
    return <p className="px-6 py-8 text-sm text-text-muted">Loading…</p>
  }
  if (config == null) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Memory</h1>
        <p className="mt-4 text-sm text-text-secondary">
          This vault has no cyber-brain contract. Memory shows here when the frontmatter of
          AGENTS.md declares <code className="font-mono text-xs">cyber_brain:</code>.
        </p>
      </div>
    )
  }
  return <MemoryOverviewView config={config} />
}

function MemoryOverviewView({ config }: { config: CyberBrainConfig }): ReactElement {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const bridgeReady = useBridgeReady()
  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'memory-overview'],
    queryFn: () => loadMemoryOverview(config),
    enabled: bridgeReady && graph !== null,
  })
  const open = (path: string): void => navigate(routeForPath(path))

  if (isError) {
    return (
      <p role="alert" className="px-6 py-8 text-sm text-text-muted">
        Couldn’t read the memory files.
      </p>
    )
  }
  if (data === undefined) {
    return <p className="px-6 py-8 text-sm text-text-muted">Loading…</p>
  }
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-text">Memory</h1>
      <p className="mt-1 text-xs text-text-muted">
        cyber-brain {config.version} · written by every agent through the vault’s own script
      </p>
      <NowSection data={data} open={open} />
      <LoopsSection data={data} open={open} />
      <DecisionsSection data={data} open={open} />
      <RunsSection data={data} open={open} />
      <HealthSection config={config} />
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
