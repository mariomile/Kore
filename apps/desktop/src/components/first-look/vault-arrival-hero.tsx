import type { ReactElement, ReactNode } from 'react'
import type { VaultTally } from '@kore/core'
import { Progress } from '@/components/ui/progress'
import type { IndexProgress } from '@/lib/index-progress'
import { cn } from '@/lib/utils'
import { useTweenedNumber } from './use-tweened-number'

interface VaultArrivalHeroProps {
  tally: VaultTally | undefined
  progress: IndexProgress | null
  filling: boolean
  readyInMs: number | null
  /** Phone type: the lead one step smaller. */
  touch?: boolean
  className?: string
}

/** "9.8 s", or "1 min 12 s" past a minute. */
export function formatReadyIn(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`
  }
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)} min ${whole % 60} s`
}

/**
 * The top of a vault's first look, written as one sentence rather than a
 * row of stat tiles: the counts climb inside the sentence while the first
 * index fills, then it says how long the vault took to come alive. The line
 * under it is the promise of the moment: the user's own files, read where
 * they are, nothing moved.
 */
export function VaultArrivalHero({
  tally,
  progress,
  filling,
  readyInMs,
  touch = false,
  className,
}: VaultArrivalHeroProps): ReactElement {
  const notes = useTweenedNumber(tally === undefined ? 0 : tally.notes + tally.dailyNotes)
  const dailies = useTweenedNumber(tally?.dailyNotes ?? 0)
  const links = useTweenedNumber(tally?.links ?? 0)
  const tasks = useTweenedNumber(tally?.tasks ?? 0)
  const percent =
    progress === null || progress.total === 0
      ? null
      : Math.round((progress.done / progress.total) * 100)

  return (
    <section aria-label="Your vault" className={className}>
      {/* The counts change twice a second; only the phase is announced. */}
      <p role="status" className="sr-only">
        {filling ? 'Reading your vault' : 'Your vault is ready'}
      </p>
      <p
        aria-hidden={filling}
        className={cn(
          'leading-snug tracking-tight text-text-secondary text-balance',
          touch ? 'text-lg' : 'text-xl',
        )}
      >
        <Figure value={notes} unit={notes === 1 ? 'note' : 'notes'} />
        {dailies > 0 ? <> ({dailies.toLocaleString()} of them daily)</> : null}
        {', '}
        <Figure value={links} unit={links === 1 ? 'link' : 'links'} />
        {' and '}
        <Figure value={tasks} unit={tasks === 1 ? 'task' : 'tasks'} />
        {filling ? (
          ' so far.'
        ) : readyInMs !== null ? (
          <>, read in {formatReadyIn(readyInMs)}.</>
        ) : (
          '.'
        )}
      </p>
      {filling && progress !== null ? (
        <div className="mt-5 max-w-lg">
          <Progress value={percent} aria-label="Reading your vault" />
          <p className="mt-2 text-xs text-text-muted tabular-nums">
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} files. Start
            writing whenever you like: this keeps going on its own.
          </p>
        </div>
      ) : (
        <p className={cn('mt-3 text-text-secondary', touch ? 'text-[15px]' : 'text-sm')}>
          Nothing was moved or converted. These are your files, exactly where they were.
        </p>
      )}
    </section>
  )
}

/** A count set in ink inside the secondary sentence around it. */
function Figure({ value, unit }: { value: number; unit: string }): ReactNode {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-text tabular-nums">{value.toLocaleString()}</span> {unit}
    </span>
  )
}
