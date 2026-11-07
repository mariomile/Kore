import { describe, expect, it } from 'vitest'
import { embedSnapshotText } from './embed-snapshot'
import { parseNote } from './extract'

/** JSON's escape for `-`, which Meowdown writes for the second dash of `--`. */
const DASH_ESCAPE = `-${String.fromCodePoint(92)}u002d`

/** The comment Meowdown writes after a resolved embed image. */
function magic(snapshot: unknown): string {
  return `<!-- ${JSON.stringify({ snapshot }).replaceAll('--', DASH_ESCAPE)} -->`
}

const POST = {
  id: '1854926130470043874',
  createdAt: '2026-11-05T09:30:00.000Z',
  author: { name: 'grim', handle: 'grimcodes', avatar: 'https://pbs.twimg.com/a.jpg' },
  body: [
    { type: 'text', text: 'Congrats to the team\nat ' },
    { type: 'link', text: '@conductor_build', url: 'https://x.com/conductor_build' },
    { type: 'text', text: ' -- shipping' },
  ],
  quote: {
    id: '2',
    createdAt: '2026-11-04T09:30:00.000Z',
    author: { name: 'Conductor', handle: 'conductor_build' },
    body: [{ type: 'text', text: 'Parallel agents' }],
  },
}

describe('embedSnapshotText', () => {
  it('reads an X post as its author and words, quote included', () => {
    expect(embedSnapshotText(magic({ kind: 'x-post', data: POST }))).toBe(
      'grim @grimcodes Congrats to the team\nat @conductor_build -- shipping Conductor @conductor_build Parallel agents',
    )
  })

  it('reads a YouTube video as its title and channel', () => {
    expect(
      embedSnapshotText(
        magic({ kind: 'youtube-video', data: { title: 'Talk', author_name: 'Kore' } }),
      ),
    ).toBe('Talk Kore')
  })

  it('leaves every other comment alone', () => {
    expect(embedSnapshotText('<!-- a note to self -->')).toBe(null)
    expect(embedSnapshotText('<!-- {"width":320} -->')).toBe(null)
    expect(embedSnapshotText('<!-- {"snapshot": -->')).toBe(null)
    expect(embedSnapshotText(magic({ kind: 'other', data: {} }))).toBe(null)
  })
})

describe('parseNote with a saved post embed', () => {
  const source = `Read this\n\n![](https://x.com/grimcodes/status/1854926130470043874)${magic({ kind: 'x-post', data: POST })}\n\nThen <!-- mine --> this\n`

  it('reads the post words where the embed sits, not its JSON', () => {
    const { text } = parseNote({ path: 'notes/test.md', source })
    expect(text).toBe(
      'Read this grim @grimcodes Congrats to the team at @conductor_build -- shipping Conductor @conductor_build Parallel agents Then <!-- mine --> this',
    )
  })
})
