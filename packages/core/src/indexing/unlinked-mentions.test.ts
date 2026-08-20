import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, afterEach } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { linkUnlinkedMention } from '../actions/link-mention'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { findUnlinkedOccurrence, getUnlinkedMentions } from './unlinked-mentions'

afterEach(() => {
  setBridge(null)
})

describe('findUnlinkedOccurrence', () => {
  it('finds a case-insensitive, word-bounded occurrence', () => {
    expect(findUnlinkedOccurrence('Talked about project atlas today.', 'Project Atlas')).toEqual({
      from: 13,
      to: 26,
    })
  })

  it('rejects partial-word matches', () => {
    expect(findUnlinkedOccurrence('The atlases arrived.', 'atlas')).toBeNull()
    expect(findUnlinkedOccurrence('Subatlas region.', 'atlas')).toBeNull()
  })

  it('skips occurrences already inside wiki links', () => {
    expect(findUnlinkedOccurrence('See [[Project Atlas]] for details.', 'Project Atlas')).toBeNull()
    const text = 'See [[Project Atlas|the plan]] and also project atlas prose.'
    expect(findUnlinkedOccurrence(text, 'Project Atlas')).toEqual({ from: 40, to: 53 })
  })

  it('skips frontmatter and lands on the prose occurrence instead', () => {
    const text = '---\ntopics: Project Atlas\n---\nWorking on project atlas today.\n'
    const found = findUnlinkedOccurrence(text, 'Project Atlas')
    expect(found).not.toBeNull()
    expect(text.slice(found!.from, found!.to)).toBe('project atlas')
    expect(found!.from).toBeGreaterThan(text.indexOf('---\nWorking'))
  })

  it('skips code, fenced and inline', () => {
    expect(
      findUnlinkedOccurrence('```\nProject Atlas\n```\nno prose here', 'Project Atlas'),
    ).toBeNull()
    expect(findUnlinkedOccurrence('Run `Project Atlas` locally.', 'Project Atlas')).toBeNull()
    // An unclosed fence excludes to the end rather than converting inside code.
    expect(findUnlinkedOccurrence('```\nProject Atlas', 'Project Atlas')).toBeNull()
  })

  it('skips markdown links and images, label and URL both', () => {
    expect(
      findUnlinkedOccurrence('See [Project Atlas](https://example.com).', 'Project Atlas'),
    ).toBeNull()
    expect(findUnlinkedOccurrence('![Project Atlas](assets/atlas.png)', 'Project Atlas')).toBeNull()
    const text = '[docs](https://example.com/Project%20Atlas) cover project atlas well.'
    const found = findUnlinkedOccurrence(text, 'Project Atlas')
    expect(text.slice(found!.from, found!.to)).toBe('project atlas')
  })
})

/** Mirror the indexer's FTS/text writes, which the projection helper skips. */
function indexText(database: DatabaseSync, path: string, title: string, text: string): void {
  database.prepare('INSERT INTO note_text(note_path, text) VALUES (?, ?)').run(path, text)
  database
    .prepare('INSERT INTO search_fts(path, title, body) VALUES (?, ?, ?)')
    .run(path, title, text)
}

function seedNote(database: DatabaseSync, path: string, source: string, mtime: number): void {
  const indexed = project(path, source, mtime)
  applyProjection(database, indexed)
  indexText(database, path, indexed.title, indexed.text)
}

describe('getUnlinkedMentions', () => {
  it('surfaces mentioning notes, skipping linked sources, itself, and private notes', async () => {
    const database = openMigratedIndex()
    try {
      seedNote(database, 'notes/project-atlas.md', '# Project Atlas\n\nProject Atlas plan.\n', 50)
      seedNote(database, 'notes/mention.md', '# Weekly\n\nDiscussed Project Atlas at length.\n', 40)
      seedNote(database, 'notes/linked.md', '# Linked\n\nSee [[Project Atlas]] rollout.\n', 30)
      seedNote(
        database,
        'notes/secret.md',
        '---\nprivate: true\n---\n# Secret\n\nProject Atlas budget.\n',
        20,
      )
      connectIndex(database)

      const mentions = await getUnlinkedMentions('notes/project-atlas.md')
      expect(mentions).toHaveLength(1)
      const mention = mentions[0]
      if (mention === undefined) {
        throw new Error('expected one mention')
      }
      expect(mention.sourcePath).toBe('notes/mention.md')
      expect(mention.sourceTitle).toBe('Weekly')
      expect(mention.targetTitle).toBe('Project Atlas')
      // The indexed text is markdown-stripped and newline-collapsed, so the
      // "line" is the whole short note; the context cap trims longer ones.
      expect(mention.snippet).toBe('Weekly Discussed Project Atlas at length.')
      expect(mention.snippet.slice(mention.matchStart, mention.matchEnd)).toBe('Project Atlas')
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('returns nothing for daily notes and short titles', async () => {
    const database = openMigratedIndex()
    try {
      seedNote(database, 'daily/2026-08-17.md', 'Met about Project Atlas.\n', 50)
      seedNote(database, 'notes/ai.md', '# AI\n\nNotes on AI.\n', 40)
      seedNote(database, 'notes/other.md', '# Other\n\nAI everywhere, every day.\n', 30)
      connectIndex(database)

      expect(await getUnlinkedMentions('daily/2026-08-17.md')).toEqual([])
      expect(await getUnlinkedMentions('notes/ai.md')).toEqual([])
    } finally {
      setBridge(null)
      database.close()
    }
  })
})

describe('linkUnlinkedMention', () => {
  function installNoteBridge(notes: Record<string, string>): Record<string, string> {
    const writes: Record<string, string> = {}
    setBridge({
      invoke: async (command, args) => {
        if (command === 'note_read') {
          return notes[String(args['path'])]
        }
        if (command === 'note_write') {
          writes[String(args['path'])] = String(args['contents'])
          return Date.now()
        }
        return null
      },
      listen: async () => () => {},
    })
    return writes
  }

  it('wraps the mention, keeping a different spelling as the alias', async () => {
    const writes = installNoteBridge({
      'notes/mention.md': '# Weekly\n\nDiscussed project atlas at length.\n',
    })
    const outcome = await linkUnlinkedMention({
      sourcePath: 'notes/mention.md',
      targetTitle: 'Project Atlas',
      generation: 1,
    })
    expect(outcome).toBe('linked')
    expect(writes['notes/mention.md']).toBe(
      '# Weekly\n\nDiscussed [[Project Atlas|project atlas]] at length.\n',
    )
  })

  it('links an exact-case mention without an alias', async () => {
    const writes = installNoteBridge({
      'notes/mention.md': 'Ship Project Atlas next week.\n',
    })
    await linkUnlinkedMention({
      sourcePath: 'notes/mention.md',
      targetTitle: 'Project Atlas',
      generation: 1,
    })
    expect(writes['notes/mention.md']).toBe('Ship [[Project Atlas]] next week.\n')
  })

  it('reports gone when the occurrence no longer exists', async () => {
    const writes = installNoteBridge({ 'notes/mention.md': 'Nothing relevant here.\n' })
    const outcome = await linkUnlinkedMention({
      sourcePath: 'notes/mention.md',
      targetTitle: 'Project Atlas',
      generation: 1,
    })
    expect(outcome).toBe('gone')
    expect(writes).toEqual({})
  })
})
