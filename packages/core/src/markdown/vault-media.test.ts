import { describe, expect, it } from 'vitest'
import { vaultMediaKind } from './vault-media'

describe('vaultMediaKind', () => {
  it('plays the video and audio files the webview can play', () => {
    expect(vaultMediaKind('demo-kore.mp4')).toBe('video')
    expect(vaultMediaKind('assets/clip.MOV')).toBe('video')
    expect(vaultMediaKind('Media/talk.webm')).toBe('video')
    expect(vaultMediaKind('audio-memos/memo-2026-11-25.m4a')).toBe('audio')
    expect(vaultMediaKind('song.mp3')).toBe('audio')
    expect(vaultMediaKind('take.mp3#t=10')).toBe('audio')
  })

  it('leaves other files, and remote links, to their pill or card', () => {
    expect(vaultMediaKind('movie.mkv')).toBeNull()
    expect(vaultMediaKind('notes.pdf')).toBeNull()
    expect(vaultMediaKind('photo.png')).toBeNull()
    expect(vaultMediaKind('https://example.com/clip.mp4')).toBeNull()
  })
})
