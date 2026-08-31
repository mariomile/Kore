import { describe, expect, it } from 'vitest'
import { parseLinkPreview } from './link-preview'

/**
 * Preview parsing runs in a real browser: `parseLinkPreview` reads the page
 * with `DOMParser`, exactly as the webview does.
 */

const PAGE = `
  <html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Startup School">
    <meta property="og:description" content="Some of the biggest companies of the next decade.">
    <meta property="og:site_name" content="Y Combinator">
    <meta property="og:image" content="/static/social.png">
  </head><body></body></html>
`

describe('parseLinkPreview', () => {
  it('reads the page and resolves its image against the link', () => {
    expect(parseLinkPreview(PAGE, 'https://www.ycombinator.com/library')).toEqual({
      url: 'https://www.ycombinator.com/library',
      title: 'Startup School',
      description: 'Some of the biggest companies of the next decade.',
      siteName: 'Y Combinator',
      imageUrl: 'https://www.ycombinator.com/static/social.png',
    })
  })

  it('falls back to the title tag and the bare host, and takes no image it cannot fetch', () => {
    const page = `<html><head><title>Ink &amp; Switch</title>
      <meta property="og:image" content="data:image/png;base64,AAAA"></head><body></body></html>`
    expect(parseLinkPreview(page, 'https://www.inkandswitch.com/local-first/')).toEqual({
      url: 'https://www.inkandswitch.com/local-first/',
      title: 'Ink & Switch',
      description: null,
      siteName: 'inkandswitch.com',
      imageUrl: null,
    })
  })

  it('has no card for a page that never names itself', () => {
    expect(
      parseLinkPreview('<html><head></head><body>hi</body></html>', 'https://example.com'),
    ).toBe(null)
  })
})
