import { describe, expect, it } from 'vitest'
import { staticDayBody } from './static-day'

describe('staticDayBody', () => {
  it('draws plain writing as static text', () => {
    const body =
      '# Monday\n\n- call [[Ada]] about #launch\n- https://example.com/post\n\n> a quote\n'
    expect(staticDayBody(body)).toBe(body)
  })

  it('draws the body of a day with plain frontmatter', () => {
    expect(staticDayBody('---\ntags: [daily]\n---\nhello\n')).toBe('hello\n')
  })

  it('draws an empty day', () => {
    expect(staticDayBody('')).toBe('')
  })

  it.each([
    ['a cover', '---\ncover: a.png\n---\nhello\n'],
    ['an icon', '---\nicon: ✨\n---\nhello\n'],
    ['an image', 'look\n\n![](assets/a.png)\n'],
    ['a note embed', 'see ![[Other note]]\n'],
    ['a code fence', '```collection\nview: table\n```\n'],
    ['an indented fence', '- item\n  ```js\n  x\n  ```\n'],
    ['block math', '$$\nx^2\n$$\n'],
    ['a table', '| a | b |\n| - | - |\n| 1 | 2 |\n'],
    ['a callout', '> [!note] Title\n> body\n'],
    ['raw HTML', 'a <details>b</details>\n'],
    ['an attached file', '[report.pdf](assets/report.pdf)\n'],
    ['conflict markers', '<<<<<<< this device\na\n=======\nb\n>>>>>>> other device\n'],
  ])('keeps the editor for %s', (_, source) => {
    expect(staticDayBody(source)).toBeNull()
  })
})
