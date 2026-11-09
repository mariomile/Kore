import { z } from 'zod'
import { CONNECTORS } from '../connectors/registry'
import { normalizeConnectorPattern, parseConnectorTags } from '../connectors/pattern'
import { syncConnector } from '../connectors/sync'
import type { Connector } from '../connectors/types'
import { errorMessage } from '../errors'
import { call } from '../ipc/invoke'

/**
 * `kore sources`: pull the connectors (Readwise, Granola) into the graph
 * with no app running, through the same engine the app runs every fifteen
 * minutes.
 *
 * This side owns the policy: which connectors exist ({@link CONNECTORS}),
 * the `KORE_<SOURCE>_*` variables that configure each one, their defaults,
 * and each source's window. The CLI only serves what it cannot know: the
 * user's flags and the per-machine window state in `.reflect/sources.json`,
 * which it persists from the reports this run sends back.
 */

const windowSchema = z.object({
  floor: z.string().nullable().optional(),
  lastSyncedAt: z.string().nullable().optional(),
})

/** What the CLI serves: its flags and the saved windows, by source id. */
const sourcesRequestSchema = z.object({
  only: z.string().nullable(),
  since: z.iso.datetime({ offset: true }).nullable(),
  state: z.record(z.string(), windowSchema),
})

export type SourcesRequest = z.infer<typeof sourcesRequestSchema>

/** The environment as `process.env` exposes it. */
export type SourcesEnv = Readonly<Record<string, string | undefined>>

/** What one source's run did, as the CLI prints and records it. */
export interface SourceRunReport {
  readonly id: string
  readonly created: number
  readonly updated: number
  /** The next run's window start; `null` when the run failed or was cut short. */
  readonly syncedAt: string | null
  /** The oldest item this source may ever import, kept across runs. */
  readonly floor: string | null
  readonly error?: string
}

/** One source's run, resolved from the environment and its saved window. */
export interface SourceRun {
  readonly connector: Connector
  readonly token: string
  readonly folder: string
  readonly pattern: string | null
  readonly tags: readonly string[] | null
  readonly since: string | null
  /** The window floor this run honors (`null` when `--since` overrides it). */
  readonly floor: string | null
  /** The floor to keep for the next run. */
  readonly keptFloor: string
}

/** The resolved plan: the runs to make, or the usage problem when none can run. */
export type SourcesPlan =
  | { readonly kind: 'runs'; readonly runs: readonly SourceRun[] }
  | { readonly kind: 'usage'; readonly usage: string }

function envValue(env: SourcesEnv, name: string): string | null {
  const value = env[name]?.trim() ?? ''
  return value === '' ? null : value
}

/** `KORE_READWISE_TOKEN` and its siblings for one connector. */
function envName(connector: Connector, field: 'TOKEN' | 'FOLDER' | 'PATTERN' | 'TAGS'): string {
  return `KORE_${connector.id.toUpperCase()}_${field}`
}

/**
 * Resolve which sources run and how: every connector with a token (or just
 * `only`), its folder, pattern and tags from the environment, and its window.
 * The first run starts the window at `now`, so history another app already
 * wrote is not duplicated; `--since` reaches further back. A pattern the
 * connector rejects throws, failing only that source.
 */
export function resolveSourceRuns(
  request: SourcesRequest,
  env: SourcesEnv,
  now: string,
): SourcesPlan {
  if (request.only !== null && !CONNECTORS.some((connector) => connector.id === request.only)) {
    return {
      kind: 'usage',
      usage: `unknown source "${request.only}"; known: ${CONNECTORS.map((c) => c.id).join(', ')}`,
    }
  }
  const runs: SourceRun[] = []
  for (const connector of CONNECTORS) {
    const token = envValue(env, envName(connector, 'TOKEN'))
    if ((request.only !== null && connector.id !== request.only) || token === null) {
      continue
    }
    const saved = request.state[connector.id]
    const keptFloor = saved?.floor ?? now
    const tags = envValue(env, envName(connector, 'TAGS'))
    runs.push({
      connector,
      token,
      folder: envValue(env, envName(connector, 'FOLDER')) ?? connector.defaultFolder,
      pattern: envValue(env, envName(connector, 'PATTERN')),
      tags: tags === null ? null : parseConnectorTags(tags),
      since: request.since ?? saved?.lastSyncedAt ?? null,
      floor: request.since === null ? keptFloor : null,
      keptFloor,
    })
  }
  if (runs.length === 0) {
    const tokens = CONNECTORS.map((connector) => envName(connector, 'TOKEN')).join(' and/or ')
    return {
      kind: 'usage',
      usage: `no source to pull: set ${tokens} (optional: KORE_<SOURCE>_FOLDER, KORE_<SOURCE>_PATTERN, KORE_<SOURCE>_TAGS)`,
    }
  }
  return { kind: 'runs', runs }
}

function date(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

async function runSource(run: SourceRun, generation: number): Promise<SourceRunReport> {
  const base = { id: run.connector.id, floor: run.keptFloor }
  try {
    const result = await syncConnector({
      connector: run.connector,
      token: run.token,
      folder: run.folder,
      pattern: run.pattern === null ? null : normalizeConnectorPattern(run.pattern, run.connector),
      tags: run.tags,
      since: date(run.since),
      floor: date(run.floor),
      generation,
      fetchFn: fetch,
      isStale: () => false,
    })
    return { ...result, ...base }
  } catch (error) {
    return {
      ...base,
      created: 0,
      updated: 0,
      syncedAt: null,
      error: errorMessage(error),
    }
  }
}

/**
 * Ask the CLI for its flags and windows and resolve the plan. A usage
 * problem is reported at once, so the caller can stop before any indexing.
 */
export async function planSources(env: SourcesEnv): Promise<readonly SourceRun[] | null> {
  const request = await call('sources_config', {}, sourcesRequestSchema)
  const plan = resolveSourceRuns(request, env, new Date().toISOString())
  if (plan.kind === 'usage') {
    await call('sources_report', { reports: [], usage: plan.usage }, z.null())
    return null
  }
  return plan.runs
}

/**
 * Run the planned sources in turn (one failing source never stops the next)
 * and send the CLI their reports.
 */
export async function syncSources(
  runs: readonly SourceRun[],
  generation: number,
): Promise<SourceRunReport[]> {
  const reports: SourceRunReport[] = []
  for (const run of runs) {
    reports.push(await runSource(run, generation))
  }
  await call('sources_report', { reports, usage: null }, z.null())
  return reports
}
