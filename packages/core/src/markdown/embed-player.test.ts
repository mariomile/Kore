import { describe, expect, it } from 'vitest'
import { embedPlayer, startSeconds } from './embed-player'

function playerUrl(url: string): string | undefined {
  return embedPlayer(url)?.url
}

describe('embedPlayer', () => {
  it('builds a cookie-less, autoplaying YouTube player', () => {
    const expected =
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1'
    expect(playerUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(expected)
    expect(playerUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(expected)
    expect(playerUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(expected)
    expect(playerUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(expected)
    expect(playerUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe(expected)
    expect(embedPlayer('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({
      provider: 'YouTube',
      height: null,
      playable: true,
    })
  })

  it('keeps a YouTube start time', () => {
    expect(playerUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1&start=90',
    )
    expect(playerUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toContain('&start=42')
  })

  it('refuses a YouTube id that could escape the player path', () => {
    expect(embedPlayer('https://www.youtube.com/watch?v=abc')).toBeNull()
    expect(embedPlayer('https://www.youtube.com/watch?v=dQw4w9WgXcQ%2F..%2Fx')).toBeNull()
    expect(embedPlayer('https://www.youtube.com/@channel')).toBeNull()
  })

  it('builds a do-not-track Vimeo player from the numeric id', () => {
    const expected = 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1'
    expect(playerUrl('https://vimeo.com/76979871')).toBe(expected)
    expect(playerUrl('https://vimeo.com/channels/staffpicks/76979871')).toBe(expected)
    expect(playerUrl('https://player.vimeo.com/video/76979871')).toBe(expected)
    expect(embedPlayer('https://vimeo.com/channels/staffpicks')).toBeNull()
  })

  it('builds a Loom player from a share or embed link', () => {
    const expected =
      'https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184?autoplay=1&hide_owner=true'
    expect(playerUrl('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184')).toBe(expected)
    expect(playerUrl('https://loom.com/embed/0281766fa2d04bb788eaf19e65135184')).toBe(expected)
    expect(embedPlayer('https://www.loom.com/pricing')).toBeNull()
  })

  it('sizes a Spotify player by what it plays', () => {
    expect(embedPlayer('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc')).toEqual({
      url: 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
      provider: 'Spotify',
      height: 152,
      playable: true,
    })
    expect(embedPlayer('https://open.spotify.com/intl-it/playlist/37i9dQZF1DXcBWIGoYBM5M')).toEqual(
      {
        url: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M',
        provider: 'Spotify',
        height: 352,
        playable: true,
      },
    )
    expect(embedPlayer('https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ')?.height).toBe(152)
    expect(embedPlayer('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3')?.height).toBe(352)
    expect(embedPlayer('https://open.spotify.com/user/someone')).toBeNull()
    expect(embedPlayer('https://open.spotify.com/track/not..an/id')).toBeNull()
  })

  it('moves Apple Music and Podcasts links onto their embed hosts', () => {
    expect(embedPlayer('https://music.apple.com/us/album/1989/1440935467?i=1440935808')).toEqual({
      url: 'https://embed.music.apple.com/us/album/1989/1440935467?i=1440935808',
      provider: 'Apple Music',
      height: 175,
      playable: true,
    })
    expect(
      embedPlayer('https://music.apple.com/it/playlist/top-100/pl.737e067787df485a8062e2c4927d94db')
        ?.height,
    ).toBe(450)
    expect(embedPlayer('https://podcasts.apple.com/us/podcast/the-daily/id1200361736')).toEqual({
      url: 'https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736',
      provider: 'Apple Podcasts',
      height: 450,
      playable: true,
    })
    expect(embedPlayer('https://music.apple.com/us/browse')).toBeNull()
  })

  it('wraps a Figma file, design, prototype or board in the Figma embed', () => {
    const file = 'https://www.figma.com/design/abc123/Kore-UI?node-id=1-2'
    expect(embedPlayer(file)).toEqual({
      url: `https://www.figma.com/embed?embed_host=kore&url=${encodeURIComponent(file)}`,
      provider: 'Figma',
      height: 450,
      playable: false,
    })
    expect(embedPlayer('https://www.figma.com/proto/abc123/Flow')?.provider).toBe('Figma')
    expect(embedPlayer('https://www.figma.com/file/abc123/Old')?.provider).toBe('Figma')
    expect(embedPlayer('https://www.figma.com/board/abc123/Jam')?.provider).toBe('Figma')
    expect(embedPlayer('https://www.figma.com/pricing')).toBeNull()
    expect(embedPlayer('https://www.figma.com/design')).toBeNull()
  })

  it('builds a CodePen result view for a user or team pen', () => {
    expect(embedPlayer('https://codepen.io/someone/pen/abcXYZ')).toEqual({
      url: 'https://codepen.io/someone/embed/abcXYZ?default-tab=result',
      provider: 'CodePen',
      height: 400,
      playable: false,
    })
    expect(playerUrl('https://codepen.io/team/acme/full/abcXYZ')).toBe(
      'https://codepen.io/team/acme/embed/abcXYZ?default-tab=result',
    )
    expect(embedPlayer('https://codepen.io/someone')).toBeNull()
  })

  it('has no player for anything else', () => {
    expect(embedPlayer('https://example.com/clip.mp4')).toBeNull()
    expect(embedPlayer('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(embedPlayer('ftp://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(embedPlayer('nonsense')).toBeNull()
  })
})

describe('startSeconds', () => {
  it('reads plain seconds and h/m/s forms', () => {
    expect(startSeconds('90')).toBe(90)
    expect(startSeconds('90s')).toBe(90)
    expect(startSeconds('1h2m3s')).toBe(3723)
    expect(startSeconds('2m')).toBe(120)
  })

  it('refuses empty, zero and malformed times', () => {
    expect(startSeconds('')).toBeNull()
    expect(startSeconds('0')).toBeNull()
    expect(startSeconds('1x')).toBeNull()
  })
})
