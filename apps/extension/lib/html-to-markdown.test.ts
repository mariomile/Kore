import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from './html-to-markdown'
import { pageTextFromArticleHtml } from './page-text'

describe('htmlToMarkdown', () => {
  it('round-trips headings, links, lists, quotes, and emphasis', () => {
    const html = `
      <h1>Title</h1>
      <p>Read the <a href="/more">full story</a> and <em>listen</em>.</p>
      <ul>
        <li>Alpha</li>
        <li>Beta
          <ul><li>Nested</li></ul>
        </li>
      </ul>
      <ol><li>First</li><li>Second</li></ol>
      <blockquote><p>Quoted <strong>line</strong></p></blockquote>
    `
    expect(htmlToMarkdown(html, { baseUrl: 'https://example.com/post' })).toBe(
      [
        '# Title',
        '',
        'Read the [full story](https://example.com/more) and *listen*.',
        '',
        '- Alpha',
        '- Beta',
        '  - Nested',
        '',
        '1. First',
        '2. Second',
        '',
        '> Quoted **line**',
      ].join('\n'),
    )
  })

  it('keeps fenced code, images, thematic breaks, and tables', () => {
    const html = `
      <pre><code class="language-ts">const value = 1;</code></pre>
      <p><img src="/hero.png" alt="Hero"></p>
      <hr>
      <table>
        <tr><th>Name</th><th>Age</th></tr>
        <tr><td>Ada</td><td>36</td></tr>
      </table>
    `
    expect(htmlToMarkdown(html, { baseUrl: 'https://example.com/post' })).toBe(
      [
        '```ts',
        'const value = 1;',
        '```',
        '',
        '![Hero](https://example.com/hero.png)',
        '',
        '---',
        '',
        '| Name | Age |',
        '| --- | --- |',
        '| Ada | 36 |',
      ].join('\n'),
    )
  })

  it('strips scripts, skips data-URL images, and decodes entities', () => {
    const html = `
      <script>alert(1)</script>
      <p>A &amp; B &#39;C&#39;</p>
      <p><img src="data:image/png;base64,aaaa" alt="hidden"></p>
      <p><a href="javascript:alert(1)">bad</a></p>
    `
    expect(htmlToMarkdown(html)).toBe("A & B 'C'\n\nbad")
  })

  it('returns empty markdown when the fragment has no readable content', () => {
    expect(htmlToMarkdown('<div><script>void 0</script></div>')).toBe('')
  })
})

describe('pageTextFromArticleHtml', () => {
  it('prefers article markdown over flattened paragraphs', () => {
    expect(pageTextFromArticleHtml('<h2>Section</h2><p>Body</p>', ['Body'])).toBe(
      '## Section\n\nBody',
    )
  })

  it('falls back to flattened paragraphs when markdown conversion is empty', () => {
    expect(pageTextFromArticleHtml('<script>void 0</script>', [' Fallback text. '])).toBe(
      'Fallback text.',
    )
  })
})
