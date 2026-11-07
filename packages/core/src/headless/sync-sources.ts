import { z } from 'zod'
import { connectorById } from '../connectors/registry'
import { syncConnector } from '../connectors/sync'
import { errorMessage } from '../errors'
import { call } from '../ipc/invoke'

/**
 * `kore sources`: pull the configured connectors (Readwise, Granola) into the
 * graph with no app running, through the same engine the app runs every
 * fifteen minutes. The CLI owns the configuration (tokens from its
 * environment, folders, each source's window) and serves it over the bridge;
 * this side only fetches and places notes, then reports what each run did.
 */

const sourceConfigSchema = z.object({
  id: z.enum(['readwise', 'granola']),
  token: z.string().min(1),
  folder: z.string(),
  since: z.iso.datetime({ offset: true }).nullable(),
  floor: z.iso.datetime({ offset: true }).nullable(),
})

const sourcesConfigSchema = z.object({ sources: z.array(sourceConfigSchema) })

/** What one source's run did, as the CLI prints and records it. */
export interface SourceRunReport {
  readonly id: string
  readonly created: number
  readonly updated: number
  /** The next run's window start; `null` when the run failed or was cut short. */
  readonly syncedAt: string | null
  readonly error?: string
}

function date(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

/** Run every configured source in turn; one failing source never stops the next. */
export async function syncSources(generation: number): Promise<SourceRunReport[]> {
  const { sources } = await call('sources_config', {}, sourcesConfigSchema)
  const reports: SourceRunReport[] = []
  for (const source of sources) {
    try {
      const result = await syncConnector({
        connector: connectorById(source.id),
        token: source.token,
        folder: source.folder,
        since: date(source.since),
        floor: date(source.floor),
        generation,
        fetchFn: fetch,
        isStale: () => false,
      })
      reports.push({ id: source.id, ...result })
    } catch (error) {
      reports.push({
        id: source.id,
        created: 0,
        updated: 0,
        syncedAt: null,
        error: errorMessage(error),
      })
    }
  }
  await call('sources_report', { reports }, z.null())
  return reports
}
