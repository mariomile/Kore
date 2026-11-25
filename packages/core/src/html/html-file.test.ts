import { describe, expect, it } from 'vitest'
import { htmlDocumentTitle, isHtmlPath } from './html-file'

describe('htmlDocumentTitle', () => {
  it('reads the title, decoded, and falls back to the first heading', () => {
    expect(htmlDocumentTitle('<head><title> Q4 &amp; <b>retention</b>\n</title></head>')).toBe(
      'Q4 & retention',
    )
    expect(htmlDocumentTitle('<title></title><h1 class="x">Kore&#32;Cloud</h1>')).toBe('Kore Cloud')
  })

  it('ignores titles inside scripts and answers null without one', () => {
    expect(
      htmlDocumentTitle('<script>const t = "<title>fake</title>"</script><p>hi</p>'),
    ).toBeNull()
  })
})

describe('isHtmlPath', () => {
  it('matches .html and .htm in any case', () => {
    expect(isHtmlPath('Reports/q4.HTML')).toBe(true)
    expect(isHtmlPath('old/page.htm')).toBe(true)
    expect(isHtmlPath('notes/html.md')).toBe(false)
  })
})
