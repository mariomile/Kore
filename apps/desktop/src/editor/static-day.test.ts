import { describe, expect, it } from 'vitest'
import { editorImageSize, staticDayBody } from './static-day'

describe('staticDayBody', () => {
  it('draws plain writing as static text', () => {
    const body =
      '# Monday\n\n- call [[Ada]] about #launch\n- https://example.com/post\n\n> a quote\n'
    expect(staticDayBody(body)).toBe(body)
  })

  it('draws the body of a day with plain frontmatter', () => {
    expect(staticDayBody('---\ntags: [daily]\n---\nhello\n')).toBe('hello\n')
  })

  it.each([
    ['a local image', 'look\n\n![](assets/a.png)\n'],
    [
      'an image with a title and spaces in its path',
      '![photo](<Resources/_attachments/image (2).jpeg> "title")\n',
    ],
    ['a remote image', '![chart](https://example.com/chart.png)\n'],
    ['an embedded image file', '![[photo.jpeg]]\n'],
    ['a sized embedded image', '![[photo.png|300]]\n'],
  ])('draws a day with %s', (_, source) => {
    expect(staticDayBody(source)).toBe(source)
  })

  it('draws an empty day', () => {
    expect(staticDayBody('')).toBe('')
  })

  it.each([
    ['a cover', '---\ncover: a.png\n---\nhello\n'],
    ['an icon', '---\nicon: ✨\n---\nhello\n'],
    ['a note embed', 'see ![[Other note]]\n'],
    ['an embedded file', '![[report.pdf]]\n'],
    ['an X post', '![](https://x.com/someone/status/1900000000000)\n'],
    ['a YouTube video', '![](https://www.youtube.com/watch?v=abc123)\n'],
    ['a malformed image', 'look ![alt](\n'],
    ['an image with a stored size', '![a](a.png)<!-- {"width":320,"height":240} -->\n'],
    ['a file in image syntax', '![](assets/report.pdf)\n'],
    ['an attached file beside an image', '![](a.png) [report.pdf](assets/report.pdf)\n'],
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

describe('editorImageSize', () => {
  it('keeps a picture shorter than the cap at its natural size', () => {
    expect(editorImageSize(350, 388, null)).toEqual({ width: 350, ratio: 350 / 388 })
  })

  it('scales a tall picture down to the cap, rounding the width up', () => {
    expect(editorImageSize(321, 505, null)).toEqual({ width: 318, ratio: 321 / 505 })
  })

  it('uses the width the markdown sets', () => {
    expect(editorImageSize(1000, 2000, 300)).toEqual({ width: 300, ratio: 0.5 })
  })

  it('has no box for a picture without a size', () => {
    expect(editorImageSize(0, 0, null)).toBeNull()
  })
})
