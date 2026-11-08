import { describe, expect, it } from 'vitest'
import { resolveSourceRuns, type SourcesRequest } from './sync-sources'

const NOW = '2026-11-08T10:00:00.000Z'

function request(fields: Partial<SourcesRequest> = {}): SourcesRequest {
  return { only: null, since: null, state: {}, ...fields }
}

describe('resolveSourceRuns', () => {
  it('runs every connector with a token, configured from its KORE_ variables', () => {
    const runs = resolveSourceRuns(
      request(),
      {
        KORE_READWISE_TOKEN: ' rw ',
        KORE_READWISE_PATTERN: '{category}/{title}',
        KORE_READWISE_TAGS: '#reading, type/reference',
        KORE_GRANOLA_FOLDER: 'Meetings',
      },
      NOW,
    )
    expect(
      Array.isArray(runs) && runs.map((run) => ({ ...run, connector: run.connector.id })),
    ).toEqual([
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
      granola: {
        floor: '2026-11-01T00:00:00Z',
        lastSyncedAt: '2026-11-07T10:00:00Z',
      },
    }
    const env = { KORE_GRANOLA_TOKEN: 'grn' }
    const [resumed] = resolveSourceRuns(request({ state }), env, NOW) as {
      since: string | null
      floor: string | null
    }[]
    expect(resumed).toMatchObject({
      since: '2026-11-07T10:00:00Z',
      floor: '2026-11-01T00:00:00Z',
    })
    const [reached] = resolveSourceRuns(
      request({ state, since: '2026-10-01T00:00:00Z' }),
      env,
      NOW,
    ) as { since: string | null; floor: string | null; keptFloor: string }[]
    expect(reached).toMatchObject({
      since: '2026-10-01T00:00:00Z',
      floor: null,
      keptFloor: '2026-11-01T00:00:00Z',
    })
  })

  it('names the problem when nothing can run', () => {
    expect(resolveSourceRuns(request({ only: 'notion' }), {}, NOW)).toEqual({
      usage: 'unknown source "notion"; known: readwise, granola',
    })
    expect(
      resolveSourceRuns(request({ only: 'granola' }), { KORE_READWISE_TOKEN: 'rw' }, NOW),
    ).toMatchObject({
      usage: expect.stringContaining('KORE_READWISE_TOKEN and/or KORE_GRANOLA_TOKEN'),
    })
  })
})
