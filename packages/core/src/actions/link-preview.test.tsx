import { describe, expect, it } from 'vitest'
import { parseLinkPreview, parseXLinkPreview } from './link-preview'

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
      kind: 'page',
      url: 'https://www.ycombinator.com/library',
      title: 'Startup School',
      description: 'Some of the biggest companies of the next decade.',
      siteName: 'Y Combinator',
      provider: null,
      imageUrl: 'https://www.ycombinator.com/static/social.png',
      iconUrl: 'https://www.ycombinator.com/favicon.ico',
    })
  })

  it('falls back to the title tag and the bare host, and takes no image it cannot fetch', () => {
    const page = `<html><head><title>Ink &amp; Switch</title>
      <meta property="og:image" content="data:image/png;base64,AAAA"></head><body></body></html>`
    expect(parseLinkPreview(page, 'https://www.inkandswitch.com/local-first/')).toEqual({
      kind: 'page',
      url: 'https://www.inkandswitch.com/local-first/',
      title: 'Ink & Switch',
      description: null,
      siteName: 'inkandswitch.com',
      provider: null,
      imageUrl: null,
      iconUrl: 'https://www.inkandswitch.com/favicon.ico',
    })
  })

  it('has no card for a page that never names itself', () => {
    expect(
      parseLinkPreview('<html><head></head><body>hi</body></html>', 'https://example.com'),
    ).toBe(null)
  })

  it('takes the favicon the page declares', () => {
    const page = `<html><head><title>Kore</title>
      <link rel="shortcut icon" href="/static/icon.png"></head><body></body></html>`
    expect(parseLinkPreview(page, 'https://kore.app/docs')?.iconUrl).toBe(
      'https://kore.app/static/icon.png',
    )
  })

  it('draws a LinkedIn post as LinkedIn, without the title chrome', () => {
    const page = `<html><head>
      <meta property="og:title" content="Granola grew 4,600% from AI search | Mario Miletta posted on the topic | LinkedIn">
      <meta property="og:description" content="Granola grew 4,600% from AI search in 7 months.">
      <meta property="og:site_name" content="LinkedIn">
      <meta property="og:image" content="https://media.licdn.com/post.jpg">
    </head><body></body></html>`
    expect(
      parseLinkPreview(page, 'https://www.linkedin.com/posts/mario_activity-1-abc'),
    ).toMatchObject({
      kind: 'page',
      provider: 'linkedin',
      siteName: 'LinkedIn',
      title: 'Granola grew 4,600% from AI search',
      imageUrl: 'https://media.licdn.com/post.jpg',
    })
  })
})

describe('parseXLinkPreview', () => {
  it('draws an X post as the post', () => {
    const json = JSON.stringify({
      text: 'Congrats to the team @conductor_build https://t.co/xyz',
      display_text_range: [0, 37],
      created_at: '2026-11-05T09:30:00.000Z',
      favorite_count: 70,
      conversation_count: 28,
      retweet_count: 4,
      user: {
        name: 'grim',
        screen_name: 'grimcodes',
        profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
      },
    })
    expect(parseXLinkPreview(json, 'https://x.com/grimcodes/status/1')).toEqual({
      kind: 'post',
      url: 'https://x.com/grimcodes/status/1',
      siteName: 'x.com',
      provider: 'x',
      iconUrl: null,
      imageUrl: null,
      authorName: 'grim',
      authorHandle: 'grimcodes',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_bigger.jpg',
      publishedAt: '2026-11-05T09:30:00.000Z',
      text: 'Congrats to the team @conductor_build',
      replies: 28,
      reposts: 4,
      likes: 70,
    })
  })

  it('has no card for a deleted post', () => {
    expect(parseXLinkPreview('{"__typename":"TweetTombstone"}', 'https://x.com/a/status/1')).toBe(
      null,
    )
  })
})
