import { describe, expect, it } from 'vitest'
import {
  resolveSourceRuns,
  type SourceRun,
  type SourcesEnv,
  type SourcesRequest,
} from './sync-sources'

const NOW = '2026-11-08T10:00:00.000Z'

function request(fields: Partial<SourcesRequest> = {}): SourcesRequest {
  return { only: null, since: null, state: {}, ...fields }
}

/** The runs a plan resolves to; fails the test on a usage problem. */
function runs(req: SourcesRequest, env: SourcesEnv): readonly SourceRun[] {
  const plan = resolveSourceRuns(req, env, NOW)
  if (plan.kind !== 'runs') {
    throw new Error(`expected runs, got: ${plan.usage}`)
  }
  return plan.runs
}

describe('resolveSourceRuns', () => {
  it('runs every connector with a token, configured from its KORE_ variables', () => {
    const resolved = runs(request(), {
      KORE_READWISE_TOKEN: ' rw ',
      KORE_READWISE_PATTERN: '{category}/{title}',
      KORE_READWISE_TAGS: '#reading, type/reference',
      KORE_GRANOLA_FOLDER: 'Meetings',
    })
    expect(resolved.map((run) => ({ ...run, connector: run.connector.id }))).toEqual([
      {
        connector: 'readwise',
        token: 'rw',
        folder: 'Readwise',
        pattern: '{category}/{title}',
        tags: ['reading', 'type/reference'],
        since: null,
        floor: NOW,
        keptFloor: NOW,
      },
    ])
  })

  it('resumes from the saved window, and --since overrides the floor but keeps it', () => {
    const state = {
      granola: { floor: '2026-11-01T00:00:00Z', lastSyncedAt: '2026-11-07T10:00:00Z' },
    }
    const env = { KORE_GRANOLA_TOKEN: 'grn' }
    expect(runs(request({ state }), env)[0]).toMatchObject({
      since: '2026-11-07T10:00:00Z',
      floor: '2026-11-01T00:00:00Z',
    })
    expect(runs(request({ state, since: '2026-10-01T00:00:00Z' }), env)[0]).toMatchObject({
      since: '2026-10-01T00:00:00Z',
      floor: null,
      keptFloor: '2026-11-01T00:00:00Z',
    })
  })

  it('names the problem when nothing can run', () => {
    expect(resolveSourceRuns(request({ only: 'notion' }), {}, NOW)).toEqual({
      kind: 'usage',
      usage: 'unknown source "notion"; known: readwise, granola',
    })
    expect(
      resolveSourceRuns(request({ only: 'granola' }), { KORE_READWISE_TOKEN: 'rw' }, NOW),
    ).toMatchObject({
      kind: 'usage',
      usage: expect.stringContaining('KORE_READWISE_TOKEN and/or KORE_GRANOLA_TOKEN'),
    })
  })
})
