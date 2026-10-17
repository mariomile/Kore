import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { getLocalGraph, LOCAL_GRAPH_DIRECT_LIMIT } from './local-graph'

afterEach(() => {
  setBridge(null)
})

function seed(database: ReturnType<typeof openMigratedIndex>, path: string, source: string): void {
  applyProjection(database, project(path, source, 10))
}

describe('getLocalGraph', () => {
  it('maps a note, its links, backlinks and up: parent, then the second ring', async () => {
    const database = openMigratedIndex()
    try {
      seed(database, 'notes/home.md', '# Home\n')
      seed(database, 'notes/atlas.md', '---\nup: "[[Home]]"\n---\n# Atlas\n\nSee [[Plan]]. #work\n')
      seed(database, 'notes/plan.md', '# Plan\n\nBack to [[Atlas]] and [[Budget]].\n')
      seed(database, 'notes/budget.md', '# Budget\n')
      seed(database, 'notes/weekly.md', '# Weekly\n\nTalked [[Atlas]]. #work\n')
      seed(database, 'notes/far.md', '# Far\n\n[[Budget]]\n')
      seed(database, 'templates/journal.md', '---\ntitle: Journal\n---\n[[Atlas]]\n')
      connectIndex(database)

      const near = await getLocalGraph('notes/atlas.md', { depth: 1, tags: false })
      expect(near.nodes.map((node) => [node.id, node.depth])).toEqual([
        ['notes/atlas.md', 0],
        ['notes/plan.md', 1],
        ['notes/home.md', 1],
        ['notes/weekly.md', 1],
      ])
      expect(near.edges).toEqual(
        expect.arrayContaining([
          { source: 'notes/atlas.md', target: 'notes/home.md', weight: 1 },
          { source: 'notes/plan.md', target: 'notes/atlas.md', weight: 1 },
          { source: 'notes/weekly.md', target: 'notes/atlas.md', weight: 1 },
        ]),
      )
      // Budget sits behind Plan: only depth 2 brings it in, never Far.
      expect(near.edges).toHaveLength(4)
      expect(near.hidden).toBe(0)

      const wide = await getLocalGraph('notes/atlas.md', { depth: 2, tags: true })
      expect(wide.nodes.find((node) => node.id === 'notes/budget.md')?.depth).toBe(2)
      expect(wide.nodes.some((node) => node.id === 'notes/far.md')).toBe(false)
      expect(wide.nodes.find((node) => node.id === '#work')?.kind).toBe('tag')
      expect(wide.edges).toEqual(
        expect.arrayContaining([
          { source: 'notes/atlas.md', target: '#work', weight: 1 },
          { source: 'notes/weekly.md', target: '#work', weight: 1 },
        ]),
      )
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('caps a hub at its strongest neighbors and counts the rest', async () => {
    const database = openMigratedIndex()
    try {
      seed(database, 'notes/home.md', '# Home\n')
      const total = LOCAL_GRAPH_DIRECT_LIMIT + 5
      for (let index = 0; index < total; index += 1) {
        const links = index === 0 ? '[[Home]] [[Home]]' : '[[Home]]'
        seed(database, `notes/n${String(index).padStart(2, '0')}.md`, `# N${index}\n\n${links}\n`)
      }
      connectIndex(database)

      const graph = await getLocalGraph('notes/home.md', { depth: 1, tags: false })
      expect(graph.nodes).toHaveLength(LOCAL_GRAPH_DIRECT_LIMIT + 1)
      expect(graph.hidden).toBe(5)
      // The double link outranks the alphabetical order.
      expect(graph.nodes[1]?.id).toBe('notes/n00.md')
    } finally {
      setBridge(null)
      database.close()
    }
  })
})
