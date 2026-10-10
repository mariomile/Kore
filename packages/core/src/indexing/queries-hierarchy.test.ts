import { describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { getNoteAncestors, getNoteChildren } from './queries-hierarchy'

/**
 * `up:` hierarchy: a note's parents come only from its `up` frontmatter, the
 * breadcrumb follows the first parent to the root, and a MOC lists the notes
 * whose `up` names it.
 */
describe('up: hierarchy', () => {
  it('builds the breadcrumb and the children list from up: only', async () => {
    const database = openMigratedIndex()
    applyProjection(database, project('Knowledge/Home.md', '# Home\n', 10))
    applyProjection(database, project('Knowledge/PKM.md', '---\nup: "[[Home]]"\n---\n# PKM\n', 20))
    applyProjection(
      database,
      project(
        'Knowledge/Zettelkasten.md',
        '---\nup:\n  - "[[PKM|Personal knowledge]]"\nrelated: "[[Home]]"\n---\n# Zettelkasten\n',
        30,
      ),
    )
    applyProjection(
      database,
      project('Knowledge/Evergreen.md', '---\nup: "[[PKM]]"\n---\n# Evergreen\n', 40),
    )
    // Links to PKM in the body or another key are backlinks, not children.
    applyProjection(
      database,
      project('Knowledge/Other.md', '---\nrelated: "[[PKM]]"\n---\n# Other\n\nSee [[PKM]].\n', 50),
    )
    connectIndex(database)

    try {
      expect(await getNoteAncestors('Knowledge/Zettelkasten.md')).toEqual([
        { path: 'Knowledge/Home.md', title: 'Home' },
        { path: 'Knowledge/PKM.md', title: 'PKM' },
      ])
      expect(await getNoteAncestors('Knowledge/Home.md')).toEqual([])
      expect((await getNoteChildren('Knowledge/PKM.md')).map((note) => note.title)).toEqual([
        'Evergreen',
        'Zettelkasten',
      ])
      // `related: [[Home]]` on Zettelkasten does not make it Home's child.
      expect((await getNoteChildren('Knowledge/Home.md')).map((note) => note.title)).toEqual([
        'PKM',
      ])
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('stops the breadcrumb at a cycle', async () => {
    const database = openMigratedIndex()
    applyProjection(database, project('A.md', '---\nup: "[[B]]"\n---\n# A\n', 10))
    applyProjection(database, project('B.md', '---\nup: "[[A]]"\n---\n# B\n', 20))
    connectIndex(database)

    try {
      expect(await getNoteAncestors('A.md')).toEqual([{ path: 'B.md', title: 'B' }])
    } finally {
      setBridge(null)
      database.close()
    }
  })
})
