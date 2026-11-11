import { useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acceptProposal,
  describeProposal,
  errorMessage,
  listProposals,
  rejectProposal,
  type Proposal,
} from '@kore/core'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { formatTimeOfDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

/** Preview lines shown per proposal before the box scrolls. */
const PREVIEW_CLASS = 'max-h-48 overflow-auto rounded-md bg-surface font-mono text-xs leading-5'

/**
 * The writes agents with a "propose" key asked for (Plan 33, A2 step 3), at
 * the top of Activity. Each shows what it would change; Accept writes it in
 * the agent's name (it then appears below like any of its changes), Reject
 * drops it. Shows nothing when none wait. When the CLI that keeps them cannot
 * answer it says so in one line with a retry, so proposals never vanish
 * silently, and the log below still shows.
 */
export function WaitingProposals({
  generation,
}: {
  generation: number | null
}): ReactElement | null {
  const bridgeReady = useBridgeReady()
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['proposals', generation],
    queryFn: () => (generation === null ? Promise.resolve([]) : listProposals(generation)),
    enabled: bridgeReady && generation !== null,
    staleTime: 10_000,
  })
  if (generation === null) {
    return null
  }
  if (error !== null && data === undefined) {
    return (
      <section aria-label="Waiting for you" className="mt-6">
        <p role="alert" className="text-xs text-destructive">
          Couldn't load agents' proposals: {errorMessage(error)}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          Try again
        </Button>
      </section>
    )
  }
  if (data === undefined || data.length === 0) {
    return null
  }
  return (
    <section aria-label="Waiting for you" className="mt-6">
      <h2 className="text-xs font-medium tracking-wide text-text-muted uppercase">
        Waiting for you
      </h2>
      <ol className="mt-2 space-y-3">
        {data.map((proposal) => (
          <ProposalRow key={proposal.id} proposal={proposal} generation={generation} />
        ))}
      </ol>
    </section>
  )
}

function ProposalRow({
  proposal,
  generation,
}: {
  proposal: Proposal
  generation: number
}): ReactElement {
  const { settings } = useSettings()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const preview = describeProposal(proposal)
  const decide = useMutation({
    mutationFn: (accept: boolean) =>
      accept ? acceptProposal(generation, proposal.id) : rejectProposal(generation, proposal.id),
    onMutate: () => setError(null),
    onError: (cause) => setError(errorMessage(cause)),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['proposals'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
    },
  })
  const subject = preview.note === null ? preview.action : `${preview.action} ${preview.note}`
  return (
    <li
      aria-label={`${proposal.agent.name}: ${subject}`}
      className="rounded-lg border border-border px-3 py-2"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-accent">{proposal.agent.name}</span>
        <span className="text-xs text-text-muted">
          {formatTimeOfDay(new Date(proposal.at), settings.timeFormat)}
        </span>
        <span className="min-w-0 truncate text-sm text-text-secondary">
          {preview.action}
          {preview.note === null ? null : (
            <span className="font-medium text-text"> {preview.note}</span>
          )}
        </span>
      </div>
      {preview.lines.length > 0 ? (
        <div className={cn(PREVIEW_CLASS, 'mt-2')}>
          {preview.lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                'whitespace-pre-wrap px-1',
                line.kind === 'add' && 'bg-accent/10 text-text',
                line.kind === 'remove' && 'bg-destructive/10 text-destructive',
                line.kind === 'detail' && 'text-text-secondary',
              )}
            >
              <span aria-hidden className="mr-2 inline-block w-3 select-none text-text-muted">
                {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
              </span>
              {line.text === '' ? ' ' : line.text}
            </div>
          ))}
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          Reject
        </Button>
      </div>
    </li>
  )
}
