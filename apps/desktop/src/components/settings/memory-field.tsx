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

function kilobytes(rssKb: number | null): string {
  return rssKb === null ? 'Unavailable' : formatBytes(rssKb * 1024)
}

/**
 * What Kore and the processes it started are holding right now.
 *
 * Physical footprint includes charged nonresident memory. RSS and helper
 * totals describe different measurements and must not be added to it.
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
      description="Native footprint includes memory that is no longer resident. Helper figures are resident memory (RSS). WebKit processes are excluded."
    >
      <div className="mt-3 space-y-2">
        {error !== null ? (
          <p className="text-xs text-text-muted">
            Could not read memory usage: {errorMessage(error)}
          </p>
        ) : null}
        {report !== undefined ? (
          <>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-text-secondary">Kore native footprint</span>
              <span className="tabular-nums text-text">
                {report.footprintBytes === null
                  ? 'Unavailable'
                  : formatBytes(report.footprintBytes)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-text-secondary">Native peak</span>
              <span className="tabular-nums text-text">
                {report.peakFootprintBytes === null
                  ? 'Unavailable'
                  : formatBytes(report.peakFootprintBytes)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-text-secondary">Native resident (RSS)</span>
              <span className="tabular-nums text-text">{kilobytes(report.rssKb)}</span>
            </div>
            {!report.processTableAvailable ? (
              <p className="text-xs text-text-muted">Helper process discovery unavailable.</p>
            ) : report.helpers.length === 0 ? (
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
