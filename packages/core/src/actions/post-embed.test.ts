import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../graph/commands', () => ({ captureOEmbedFetch: vi.fn() }))

const { captureOEmbedFetch } = await import('../graph/commands')
const { resolveXPostEmbed, resolveYouTubeEmbed } = await import('./post-embed')
const fetchJson = vi.mocked(captureOEmbedFetch)

/** A syndication answer in the shape cdn.syndication.twimg.com returns. */
const TWEET = {
  __typename: 'Tweet',
  id_str: '1854926130470043874',
  text: 'Congrats to the team @conductor_build',
  created_at: '2026-11-05T09:30:00.000Z',
  favorite_count: 70,
  conversation_count: 28,
  display_text_range: [0, 37],
  entities: { hashtags: [], urls: [], user_mentions: [], symbols: [] },
  user: {
    id_str: '1',
    name: 'grim',
    screen_name: 'grimcodes',
    profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    verified: false,
    is_blue_verified: false,
    profile_image_shape: 'Circle',
  },
  edit_control: {
    edit_tweet_ids: ['1854926130470043874'],
    editable_until_msecs: '0',
    is_edit_eligible: false,
    edits_remaining: '0',
  },
  isEdited: false,
  isStaleEdit: false,
}

beforeEach(() => {
  fetchJson.mockReset()
})

describe('resolveXPostEmbed', () => {
  it('reads the post from X through the bounded Rust fetch', async () => {
    fetchJson.mockResolvedValue(JSON.stringify(TWEET))
    const post = await resolveXPostEmbed('https://x.com/grimcodes/status/1854926130470043874')
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=1854926130470043874&/,
      ),
    )
    expect(post?.id).toBe('1854926130470043874')
    expect(JSON.stringify(post)).toContain('grimcodes')
  })

  it('is unavailable for a deleted post, a failed fetch, or a non-post link', async () => {
    fetchJson.mockResolvedValueOnce('{"__typename":"TweetTombstone"}')
    expect(await resolveXPostEmbed('https://x.com/a/status/11')).toBe(undefined)
    fetchJson.mockRejectedValueOnce(new Error('offline'))
    expect(await resolveXPostEmbed('https://x.com/a/status/12')).toBe(undefined)
    expect(await resolveXPostEmbed('https://x.com/a')).toBe(undefined)
  })

  it('retries a link whose last attempt failed', async () => {
    fetchJson.mockRejectedValueOnce(new Error('offline'))
    expect(await resolveXPostEmbed('https://x.com/a/status/13')).toBe(undefined)
    fetchJson.mockResolvedValueOnce(
      JSON.stringify({
        ...TWEET,
        id_str: '13',
        edit_control: { ...TWEET.edit_control, edit_tweet_ids: ['13'] },
      }),
    )
    expect((await resolveXPostEmbed('https://x.com/a/status/13'))?.id).toBe('13')
  })
})

describe('resolveYouTubeEmbed', () => {
  it('reads the oEmbed answer and keeps the link', async () => {
    fetchJson.mockResolvedValue(JSON.stringify({ title: 'Talk', author_name: 'Kore' }))
    const url = 'https://www.youtube.com/watch?v=abc123'
    expect(await resolveYouTubeEmbed(url)).toMatchObject({ title: 'Talk', url })
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('https://www.youtube.com/oembed'),
    )
  })
})
