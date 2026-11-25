import { describe, expect, it } from 'vitest'
import { parseIframeEmbed } from './iframe-embed'

describe('parseIframeEmbed', () => {
  it('reads a pasted frame: its page, height and title', () => {
    const embed = parseIframeEmbed(
      '<iframe title="Rents by city" src="https://datawrapper.dwcdn.net/abc12/1/" width="100%" height="420" frameborder="0"></iframe>',
    )
    expect(embed).toEqual({
      title: 'Rents by city',
      player: {
        url: 'https://datawrapper.dwcdn.net/abc12/1/',
        provider: 'datawrapper.dwcdn.net',
        height: 420,
        playable: false,
      },
    })
  })

  it('keeps a frame without a usable height 16:9, and decodes the source', () => {
    const embed = parseIframeEmbed(
      "<iframe src='https://www.google.com/maps/embed?pb=1&amp;x=2' height='80%'>\n</iframe>",
    )
    expect(embed?.player).toMatchObject({
      url: 'https://www.google.com/maps/embed?pb=1&x=2',
      provider: 'google.com',
      height: null,
    })
    expect(embed?.title).toBe(null)
  })

  it('gives a known provider its own player', () => {
    const embed = parseIframeEmbed(
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube video player"></iframe>',
    )
    expect(embed?.player.provider).toBe('YouTube')
    expect(embed?.player.playable).toBe(true)
  })

  it('leaves anything that is not one https frame as text', () => {
    for (const text of [
      '<iframe src="http://example.com"></iframe>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe></iframe>',
      'see <iframe src="https://example.com"></iframe>',
      '<iframe src="https://example.com"></iframe><script></script>',
      '<script src="https://example.com"></script>',
    ]) {
      expect(parseIframeEmbed(text), text).toBe(null)
    }
  })
})
