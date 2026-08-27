import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage, memoryReport } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { formatBytes } from '@/lib/format-bytes'
import { SettingsField } from './field'

/** `/opt/homebrew/bin/node` → `node`; a bare name passes through. */
function commandName(command: string): string {
  return command.split('/').at(-1) ?? command
}

function kilobytes(rssKb: number): string {
  return formatBytes(rssKb * 1024)
}

/**
 * What Memento and the processes it started are holding right now.
 *
 * The number people quote from Activity Monitor is the app plus every helper
 * it spawned — an agent CLI run with its MCP servers, a terminal with what
 * runs inside it — and those are separate processes with separate
 * footprints. Listing them is what turns "the app uses 10GB" into an
 * answerable question: an empty helper list points at the app itself, a heavy
 * one points at the helpers.
 *
 * Helpers that outlive the work that started them are the leak the process-
 * tree teardown exists to prevent, and this is where that is checked: with no
 * chat running and no terminal open, the list should be empty.
 */
export function MemoryField(): ReactElement {
  const bridgeReady = useBridgeReady()
  const {
    data: report,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['memory-report'],
    queryFn: memoryReport,
    enabled: bridgeReady,
    gcTime: 0,
  })

  return (
    <SettingsField
      legend="Memory"
      description="What Memento and the helper processes it started are using right now. With no chat running and no terminal open, the helper list should be empty."
    >
      <div className="mt-3 space-y-2">
        {error !== null ? (
          <p className="text-xs text-text-muted">
            Could not read the process table: {errorMessage(error)}
          </p>
        ) : null}
        {report !== undefined ? (
          <>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-text-secondary">Memento</span>
              <span className="tabular-nums text-text">{kilobytes(report.rssKb)}</span>
            </div>
            {report.helpers.length === 0 ? (
              <p className="text-xs text-text-muted">No helper processes.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-text-secondary">
                    {report.helpers.length === 1
                      ? '1 helper process'
                      : `${report.helpers.length} helper processes`}
                  </span>
                  <span className="tabular-nums text-text">{kilobytes(report.helpersRssKb)}</span>
                </div>
                <ul className="space-y-1">
                  {report.helpers.map((helper) => (
                    <li
                      key={helper.pid}
                      className="flex items-baseline justify-between gap-4 text-xs text-text-muted"
                    >
                      <span className="truncate">
                        {commandName(helper.command)}{' '}
                        <span className="tabular-nums">#{helper.pid}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{kilobytes(helper.rssKb)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : null}
        <div className="flex justify-start pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="text-text-secondary"
          >
            {isFetching ? 'Reading…' : 'Refresh'}
          </Button>
        </div>
      </div>
    </SettingsField>
  )
}
