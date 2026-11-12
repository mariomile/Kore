import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { getTasksForTag } from './queries-tasks'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'

/**
 * Tagged checkbox lines as rows of the tag's database (organization point 4),
 * read over a real migrated index.
 */

let database: ReturnType<typeof openMigratedIndex>

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
})

afterEach(() => {
  setBridge(null)
  database.close()
})

describe('getTasksForTag', () => {
  it('lists the checkboxes tagged on their own line, open first, never a longer tag', async () => {
    applyProjection(
      database,
      project(
        'daily/2026-11-12.md',
        [
          '- [ ] chiamare Andrea #lead',
          '- [x] mandare la proposta #Lead [[Acme]]',
          '- [ ] parlare col capo #leader',
          '- [ ] senza tag',
          'Una frase su #lead che non è un task.',
        ].join('\n'),
        2,
      ),
    )
    applyProjection(database, project('notes/crm.md', '# CRM\n\n- [ ] scrivere a Bea #lead\n', 1))

    const rows = await getTasksForTag('Lead')

    expect(rows.map((row) => [row.text, row.checked, row.notePath])).toEqual([
      ['chiamare Andrea #lead', false, 'daily/2026-11-12.md'],
      ['scrivere a Bea #lead', false, 'notes/crm.md'],
      ['mandare la proposta #Lead Acme', true, 'daily/2026-11-12.md'],
    ])
  })
})
