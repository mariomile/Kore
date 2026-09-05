import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildIndexedNote,
  parseNote,
  recallForMessage,
  recallSearchHits,
  setBridge,
  type IndexedNote,
} from '@reflect/core'
import { createDevIndexDb, type DevIndexDb } from '@/dev/dev-index-db'

/**
 * Concrete recall scenarios over real SQL (roadmap Now item 3a): the notes a
 * message should resurface, the ones it must not, and the privacy line that
 * chat recall never crosses — run against the same migrations and FTS the
 * app uses, via the dev bridge's SQLite.
 */

const sources = new Map<string, string>()

function indexed(path: string, source: string): IndexedNote {
  sources.set(path, source)
  return buildIndexedNote(parseNote({ path, source }), {
    fileHash: `hash:${path}`,
    mtime: 1_700_000_000_000,
    source,
  })
}

let db: DevIndexDb

beforeEach(async () => {
  db = await createDevIndexDb()
  setBridge({
    invoke: async (command, args) => {
      if (command === 'note_read') {
        return sources.get(String(args['path']))
      }
      if (command !== 'db_query') {
        throw new Error(`Unexpected command: ${command}`)
      }
      const record = args as Record<string, unknown>
      return db.query(String(record['sql']), (record['params'] as readonly unknown[]) ?? [])
    },
    listen: async () => () => {},
  })

  db.applyNote(
    indexed(
      'daily/2026-08-29.md',
      '- Call with [[Sarah Chen]] about the Kore V2 launch\n- She wants the pricing tiers by Friday\n',
    ),
  )
  db.applyNote(
    indexed(
      'notes/pricing.md',
      '# Pricing\n\nDecided: three tiers, free / pro / team. Pro at 12 euro.\n',
    ),
  )
  db.applyNote(
    indexed(
      'notes/segreta.md',
      '---\nprivate: true\n---\n# Segreta\n\nThe pricing passphrase is tartaruga-viola.\n',
    ),
  )
  db.applyNote(indexed('notes/ricette.md', '# Ricette\n\nCarbonara: guanciale, pecorino, uova.\n'))
})

afterEach(() => setBridge(null))

describe('vault recall scenarios', () => {
  it('resurfaces the daily note that answers the question', async () => {
    const hits = await recallForMessage('Com’era andata la call con Sarah?')
    expect(hits.map((hit) => hit.path)).toContain('daily/2026-08-29.md')
    const daily = hits.find((hit) => hit.path === 'daily/2026-08-29.md')
    expect(daily?.dailyDate).toBe('2026-08-29')
    expect(daily?.snippet).toContain('Sarah')
  })

  it('ranks the note matching more of the message first', async () => {
    const hits = await recallForMessage('che pricing avevamo deciso, i tiers?')
    expect(hits[0]?.path).toBe('notes/pricing.md')
  })

  it('never recalls a private note, even on an exact match', async () => {
    const hits = await recallSearchHits(['tartaruga-viola', 'passphrase'])
    expect(hits).toEqual([])
  })

  it('recalls nothing for a message the vault knows nothing about', async () => {
    const hits = await recallForMessage('previsioni meteo per la maratona di domenica')
    expect(hits).toEqual([])
  })

  it('leaves the mentioned note to its mention', async () => {
    const hits = await recallForMessage('aggiorna [[Pricing]] con i tiers nuovi', [
      'notes/pricing.md',
    ])
    expect(hits.map((hit) => hit.path)).not.toContain('notes/pricing.md')
  })
})
