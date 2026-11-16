import { describe, expect, it } from 'vitest'
import { formatEmbedBlock, formatUrlEmbedBody, parseEmbedBlocks } from './embed-block'

function fence(body: string): string {
  return `Before\n\n\`\`\`embed\n${body}\n\`\`\`\n\nAfter\n`
}

describe('parseEmbedBlocks', () => {
  it('classifies a URL embed by what the link points at', () => {
    expect(parseEmbedBlocks(fence('https://github.com/mariomile/Kore'))).toEqual([
      { kind: 'url', url: 'https://github.com/mariomile/Kore', linkKind: 'repo', layout: 'card' },
    ])
    expect(parseEmbedBlocks(fence('https://youtu.be/abc'))[0]).toMatchObject({ linkKind: 'video' })
  })

  it('reads a body opening with a tag as raw HTML', () => {
    expect(parseEmbedBlocks(fence('<iframe src="https://example.com"></iframe>'))).toEqual([
      { kind: 'html', html: '<iframe src="https://example.com"></iframe>' },
    ])
  })

  it('keeps multi-line HTML intact', () => {
    const html = '<div class="widget">\n  <span>hi</span>\n</div>'
    expect(parseEmbedBlocks(fence(html))).toEqual([{ kind: 'html', html }])
  })

  it('collects every fence in source order', () => {
    const markdown = `${fence('https://youtu.be/abc')}${fence('https://example.com/x.png')}`
    expect(
      parseEmbedBlocks(markdown).map((block) => block.kind === 'url' && block.linkKind),
    ).toEqual(['video', 'image'])
  })

  it('skips a fence it cannot render, leaving it visible as code', () => {
    expect(parseEmbedBlocks(fence(''))).toEqual([])
    expect(parseEmbedBlocks(fence('not a url'))).toEqual([])
    expect(parseEmbedBlocks(fence('https://a.test https://b.test'))).toEqual([])
    expect(parseEmbedBlocks(fence('javascript:alert(1)'))).toEqual([])
    expect(parseEmbedBlocks(fence(`<div>${'x'.repeat(20_001)}</div>`))).toEqual([])
  })

  it('ignores a fence of another language', () => {
    expect(parseEmbedBlocks('```html\nhttps://youtu.be/abc\n```\n')).toEqual([])
  })

  it('reads an optional layout line after the URL', () => {
    expect(parseEmbedBlocks(fence('https://captoo.io\nlayout: compact'))[0]).toMatchObject({
      url: 'https://captoo.io',
      layout: 'compact',
    })
    expect(parseEmbedBlocks(fence('https://captoo.io\nlayout: large'))[0]).toMatchObject({
      layout: 'large',
    })
    expect(parseEmbedBlocks(fence('https://captoo.io\nlayout: huge'))).toEqual([])
    expect(parseEmbedBlocks(fence('https://captoo.io\nlayout: large\nmore'))).toEqual([])
  })

  it('writes the layout line only when it is not the default card', () => {
    expect(formatUrlEmbedBody('https://captoo.io', 'card')).toBe('https://captoo.io')
    expect(formatUrlEmbedBody('https://captoo.io', 'large')).toBe(
      'https://captoo.io\nlayout: large',
    )
    const [large] = parseEmbedBlocks(fence('https://captoo.io\nlayout: large'))
    expect(parseEmbedBlocks(`${formatEmbedBlock(large!)}\n`)).toEqual([large])
  })

  it('round-trips through formatEmbedBlock', () => {
    const blocks = parseEmbedBlocks(fence('https://vimeo.com/76979871'))
    expect(parseEmbedBlocks(`${formatEmbedBlock(blocks[0]!)}\n`)).toEqual(blocks)
  })
})
