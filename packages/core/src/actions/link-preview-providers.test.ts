import { describe, expect, it } from 'vitest'
import {
  cleanLinkedInTitle,
  linkedInEmbedUrl,
  parseXPost,
  xPostId,
  xSyndicationUrl,
} from './link-preview-providers'

describe('xPostId', () => {
  it('reads the post id from x.com and twitter.com links', () => {
    expect(xPostId('https://x.com/grimcodes/status/1854926130470043874')).toBe(
      '1854926130470043874',
    )
    expect(xPostId('https://twitter.com/jack/status/20?s=20')).toBe('20')
    expect(xPostId('https://mobile.twitter.com/jack/status/20/photo/1')).toBe('20')
    expect(xPostId('https://x.com/i/web/status/42')).toBe('42')
  })

  it('ignores profiles, other sites and non-web links', () => {
    expect(xPostId('https://x.com/grimcodes')).toBe(null)
    expect(xPostId('https://example.com/a/status/1')).toBe(null)
    expect(xPostId('not a url')).toBe(null)
  })
})

describe('xSyndicationUrl', () => {
  it('asks the embed endpoint with the derived token', () => {
    const url = new URL(xSyndicationUrl('1854926130470043874'))
    expect(url.origin + url.pathname).toBe('https://cdn.syndication.twimg.com/tweet-result')
    expect(url.searchParams.get('id')).toBe('1854926130470043874')
    expect(url.searchParams.get('token')).toBe('4hvf7b1adn3')
  })
})

describe('parseXPost', () => {
  it('keeps the words, expands links, decodes entities and drops the media link', () => {
    const post = parseXPost(
      JSON.stringify({
        text: 'Tools &amp; tips 🚀 https://t.co/a https://t.co/media',
        display_text_range: [0, 33],
        entities: { urls: [{ url: 'https://t.co/a', display_url: 'kore.app/docs' }] },
        user: { name: 'Kore', screen_name: 'kore' },
        photos: [{ url: 'https://pbs.twimg.com/media/x.jpg' }],
      }),
    )
    expect(post).toMatchObject({
      text: 'Tools & tips 🚀 kore.app/docs',
      imageUrl: 'https://pbs.twimg.com/media/x.jpg',
      avatarUrl: null,
      publishedAt: null,
      replies: null,
      reposts: null,
      likes: null,
    })
  })

  it('refuses answers that are not posts', () => {
    expect(parseXPost('not json')).toBe(null)
    expect(parseXPost('{}')).toBe(null)
  })
})

describe('LinkedIn', () => {
  it('sends feed links to their public embed page', () => {
    expect(
      linkedInEmbedUrl('https://www.linkedin.com/feed/update/urn:li:activity:7254881938491514880/'),
    ).toBe('https://www.linkedin.com/embed/feed/update/urn:li:activity:7254881938491514880')
    expect(linkedInEmbedUrl('https://www.linkedin.com/posts/someone_activity-1-abc')).toBe(null)
    expect(linkedInEmbedUrl('https://example.com/feed/update/urn:li:activity:1')).toBe(null)
  })

  it('strips the title chrome LinkedIn adds', () => {
    expect(cleanLinkedInTitle('Big news | Ada posted on the topic | LinkedIn')).toBe('Big news')
    expect(cleanLinkedInTitle('Ada Lovelace | LinkedIn')).toBe('Ada Lovelace')
    expect(cleanLinkedInTitle('LinkedIn')).toBe('LinkedIn')
  })
})
