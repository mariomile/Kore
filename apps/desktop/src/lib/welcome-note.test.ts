import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_OBJECTS, parseNote, setBridge, isPinned } from '@reflect/core'
import {
  DEFAULT_OBJECTS_SEEDED_META_KEY,
  ensureFirstRunSeeds,
  WELCOME_NOTE_PATH,
  WELCOME_SEEDED_META_KEY,
} from './welcome-note'

interface WrittenNote {
  path: string
  contents: string
}

interface FakeGraph {
  written: WrittenNote[]
  meta: Record<string, string>
}

function installFakeBridge(options: {
  stats?: { notes?: number; attachments?: number; skipped?: number }
  meta?: Record<string, string>
}): FakeGraph {
  const graph: FakeGraph = { written: [], meta: { ...options.meta } }
  setBridge({
    invoke: async (command, args) => {
      switch (command) {
        case 'vault_scan_stats':
          return {
            notes: options.stats?.notes ?? 0,
            attachments: options.stats?.attachments ?? 0,
            skipped: options.stats?.skipped ?? 0,
          }
        case 'note_write':
          graph.written.push({ path: String(args['path']), contents: String(args['contents']) })
          return null
        case 'note_create':
          graph.written.push({ path: String(args['path']), contents: String(args['contents']) })
          return { kind: 'created', modifiedMs: 1 }
        case 'index_meta_set':
          graph.meta[String(args['key'])] = String(args['value'])
          return null
        case 'db_query': {
          const key = String((args['params'] as unknown[])?.[0])
          return key in graph.meta ? [{ value: graph.meta[key] }] : []
        }
        default:
          throw new Error(`unexpected command: ${command}`)
      }
    },
    listen: async () => () => {},
  })
  return graph
}

const GENERATIONS = { fileGeneration: 1, indexGeneration: 7 }

const OBJECT_PATHS = ['tags/project.md', 'tags/person.md', 'tags/company.md', 'tags/meeting.md']

afterEach(() => {
  setBridge(null)
})

describe('ensureFirstRunSeeds', () => {
  it('seeds the welcome note and every default object into an empty unmarked graph', async () => {
    const graph = installFakeBridge({})
    expect(await ensureFirstRunSeeds(GENERATIONS)).toBe(true)

    expect(graph.written.map((note) => note.path)).toEqual([WELCOME_NOTE_PATH, ...OBJECT_PATHS])
    expect(WELCOME_NOTE_PATH).toBe('notes/how-to-use-kore.md')
    expect(graph.meta[WELCOME_SEEDED_META_KEY]).toBe('true')
    expect(graph.meta[DEFAULT_OBJECTS_SEEDED_META_KEY]).toBe('true')
    expect(DEFAULT_VAULT_OBJECTS).toHaveLength(OBJECT_PATHS.length)

    const { frontmatter, title } = parseNote({
      path: graph.written[0]!.path,
      source: graph.written[0]!.contents,
    })
    expect(title).toBe('How to use Kore')
    expect(isPinned(frontmatter)).toBe(true)
    expect(frontmatter.id).toBeDefined()
  })

  it.each([
    { label: 'notes anywhere in the vault', stats: { notes: 2 } },
    { label: 'only attachments (a folder of PDFs)', stats: { attachments: 3 } },
    { label: 'only skipped entries (unreadable content)', stats: { skipped: 1 } },
  ])('marks a vault with $label without writing into it', async ({ stats }) => {
    const graph = installFakeBridge({ stats })
    expect(await ensureFirstRunSeeds(GENERATIONS)).toBe(false)
    expect(graph.written).toHaveLength(0)
    expect(graph.meta[WELCOME_SEEDED_META_KEY]).toBe('true')
    expect(graph.meta[DEFAULT_OBJECTS_SEEDED_META_KEY]).toBe('true')
  })

  it('does nothing once both markers are set — an emptied graph is not re-seeded', async () => {
    const graph = installFakeBridge({
      meta: {
        [WELCOME_SEEDED_META_KEY]: 'true',
        [DEFAULT_OBJECTS_SEEDED_META_KEY]: 'true',
      },
    })
    expect(await ensureFirstRunSeeds(GENERATIONS)).toBe(false)
    expect(graph.written).toHaveLength(0)
  })

  it('marks a graph that predates the objects without writing into it', async () => {
    // Welcome already considered (an existing user's vault, notes on disk):
    // the objects seed only records its marker.
    const graph = installFakeBridge({
      stats: { notes: 40 },
      meta: { [WELCOME_SEEDED_META_KEY]: 'true' },
    })
    expect(await ensureFirstRunSeeds(GENERATIONS)).toBe(false)
    expect(graph.written).toHaveLength(0)
    expect(graph.meta[DEFAULT_OBJECTS_SEEDED_META_KEY]).toBe('true')
  })

  it('never treats an emptied, welcome-marked graph as brand-new', async () => {
    // The user deleted everything after onboarding: the graph is theirs, not
    // new — the objects mark without writing, same as the welcome would.
    const graph = installFakeBridge({ meta: { [WELCOME_SEEDED_META_KEY]: 'true' } })
    expect(await ensureFirstRunSeeds(GENERATIONS)).toBe(false)
    expect(graph.written).toHaveLength(0)
    expect(graph.meta[DEFAULT_OBJECTS_SEEDED_META_KEY]).toBe('true')
  })
})
