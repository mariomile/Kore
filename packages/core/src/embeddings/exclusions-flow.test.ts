import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { setBridge } from '../ipc/bridge'
import { applyProjection, openMigratedIndex, project } from '../indexing/flow-test-harness'
import { backfillEmbeddings, embedNote } from './pipeline'

/**
 * Excluded folders against a real SQLite index from the production
 * migrations: the backfill drops the vectors a folder already had, never
 * embeds its notes again, and leaves every other note's embeddings alone.
 */
const MODEL = 'all-MiniLM-L6-v2'
const EXCLUDED = ['Input/Transcripts']

let database: DatabaseSync
let embeddedTexts: string[]
let removed: string[]

function embeddedPaths(): string[] {
  return database
    .prepare('SELECT DISTINCT note_path FROM embedding_chunks ORDER BY note_path')
    .all()
    .map((row) => String(row['note_path']))
}

function addNote(path: string, body: string, embedded: boolean): void {
  applyProjection(database, project(path, body, 1000))
  if (embedded) {
    database
      .prepare(
        `INSERT INTO embedding_chunks(note_path, heading, pos_from, pos_to, text, content_hash, model_id)
         VALUES (?, NULL, 0, 1, 'stored', 'stored-hash', ?)`,
      )
      .run(path, MODEL)
  }
}

beforeEach(() => {
  database = openMigratedIndex()
  embeddedTexts = []
  removed = []
  const disk = new Map<string, string>()
  const note = (path: string, body: string, embedded: boolean): void => {
    disk.set(path, body)
    addNote(path, body, embedded)
  }
  note('notes/idea.md', '# Idea\n\nA note worth finding by meaning.\n', false)
  note('Input/Transcripts/call.md', '# Call\n\nSpeaker A: hello. Speaker B: hello.\n', true)
  note('Input/Transcripts/2026/older.md', '# Older\n\nSpeaker A: goodbye.\n', true)
  note('Input/Transcripts Index.md', '# Index\n\nA sibling that only shares the prefix.\n', false)
  setBridge({
    invoke: (command, args) => {
      switch (command) {
        case 'db_query':
          return Promise.resolve(
            database.prepare(String(args['sql'])).all(...(args['params'] as SQLInputValue[])),
          )
        case 'note_read_local': {
          const content = disk.get(String(args['path']))
          return content === undefined
            ? Promise.reject({ kind: 'notFound', message: 'not on disk' })
            : Promise.resolve({ kind: 'content', content })
        }
        case 'embed_texts': {
          const texts = args['texts'] as string[]
          embeddedTexts.push(...texts)
          return Promise.resolve(texts.map(() => [0.5, 0.5]))
        }
        case 'embed_apply': {
          const path = String(args['path'])
          database.prepare('DELETE FROM embedding_chunks WHERE note_path = ?').run(path)
          for (const chunk of args['chunks'] as { text: string; contentHash: string }[]) {
            database
              .prepare(
                `INSERT INTO embedding_chunks(note_path, heading, pos_from, pos_to, text, content_hash, model_id)
                 VALUES (?, NULL, 0, 1, ?, ?, ?)`,
              )
              .run(path, chunk.text, chunk.contentHash, MODEL)
          }
          return Promise.resolve(null)
        }
        case 'embed_remove': {
          const path = String(args['path'])
          removed.push(path)
          database.prepare('DELETE FROM embedding_chunks WHERE note_path = ?').run(path)
          return Promise.resolve(null)
        }
        default:
          return Promise.reject(new Error(`unexpected command: ${command}`))
      }
    },
    listen: () => Promise.resolve(() => {}),
  })
})

afterEach(() => {
  setBridge(null)
  database.close()
})

describe('excluded folders', () => {
  it('drops the folder’s vectors and embeds everything else', async () => {
    const outcome = await backfillEmbeddings({
      generation: 1,
      modelId: MODEL,
      excludedFolders: EXCLUDED,
    })
    expect(outcome).toBe('completed')
    expect(embeddedPaths()).toEqual(['Input/Transcripts Index.md', 'notes/idea.md'])
    expect(embeddedTexts.join(' ')).not.toContain('Speaker')
    expect(removed.sort()).toEqual(['Input/Transcripts/2026/older.md', 'Input/Transcripts/call.md'])
  })

  it('writes nothing on the next pass over a settled vault', async () => {
    await backfillEmbeddings({ generation: 1, modelId: MODEL, excludedFolders: EXCLUDED })
    removed = []
    embeddedTexts = []
    await backfillEmbeddings({ generation: 1, modelId: MODEL, excludedFolders: EXCLUDED })
    expect(removed).toEqual([])
    expect(embeddedTexts).toEqual([])
  })

  it('embeds the folder again once it is no longer excluded', async () => {
    await backfillEmbeddings({ generation: 1, modelId: MODEL, excludedFolders: EXCLUDED })
    await backfillEmbeddings({ generation: 1, modelId: MODEL, excludedFolders: [] })
    expect(embeddedPaths()).toContain('Input/Transcripts/call.md')
    expect(embeddedPaths()).toContain('Input/Transcripts/2026/older.md')
  })

  it('drops a live change’s vectors instead of embedding it', async () => {
    const count = await embedNote({
      path: 'Input/Transcripts/call.md',
      generation: 1,
      modelId: MODEL,
      excludedFolders: EXCLUDED,
    })
    expect(count).toBe(0)
    expect(embeddedTexts).toEqual([])
    expect(embeddedPaths()).toEqual(['Input/Transcripts/2026/older.md'])
  })
})
