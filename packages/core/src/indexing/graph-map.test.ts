import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { getGraphMap } from './graph-map'

afterEach(() => {
  setBridge(null)
})

function seed(database: ReturnType<typeof openMigratedIndex>, path: string, source: string): void {
  applyProjection(database, project(path, source, 10))
}

describe('getGraphMap', () => {
  it('maps notes to nodes and resolved links to weighted edges', async () => {
    const database = openMigratedIndex()
    try {
      seed(database, 'notes/atlas.md', '# Atlas\n\nThe plan.\n')
      seed(
        database,
        'notes/weekly.md',
        '# Weekly\n\nSee [[Atlas]] twice: [[Atlas]]. Also [[Nowhere]].\n',
      )
      seed(database, 'daily/2026-08-20.md', 'Reviewed [[Atlas]].\n')
      seed(database, 'templates/journal.md', '---\ntitle: Journal\n---\nMood: [[Atlas]]\n')
      connectIndex(database)

      const map = await getGraphMap()
      // Templates are neither nodes nor edge sources.
      expect(map.nodes.map((node) => node.path)).toEqual([
        'daily/2026-08-20.md',
        'notes/atlas.md',
        'notes/weekly.md',
      ])
      const atlas = map.nodes.find((node) => node.path === 'notes/atlas.md')
      expect(atlas?.inbound).toBe(3) // two from weekly + one from the daily
      const daily = map.nodes.find((node) => node.dailyDate === '2026-08-20')
      expect(daily).toBeDefined()

      // The unresolved [[Nowhere]] link produces no edge; the double link
      // collapses to one edge of weight 2.
      expect(map.edges).toEqual(
        expect.arrayContaining([
          { source: 'notes/weekly.md', target: 'notes/atlas.md', weight: 2 },
          { source: 'daily/2026-08-20.md', target: 'notes/atlas.md', weight: 1 },
        ]),
      )
      expect(map.edges).toHaveLength(2)
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('returns an empty map for an empty graph', async () => {
    const database = openMigratedIndex()
    try {
      connectIndex(database)
      await expect(getGraphMap()).resolves.toEqual({ nodes: [], edges: [] })
    } finally {
      setBridge(null)
      database.close()
    }
  })
})
