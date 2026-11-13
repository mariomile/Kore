import { describe, expect, it } from 'vitest'
import { linkKind, linkKindInfo } from './link-kind'

describe('linkKind', () => {
  it('reads a video host', () => {
    expect(linkKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('video')
    expect(linkKind('https://youtu.be/dQw4w9WgXcQ')).toBe('video')
    expect(linkKind('https://vimeo.com/76979871')).toBe('video')
  })

  it('reads an owner/repo path on a forge as a repository', () => {
    expect(linkKind('https://github.com/mariomile/Kore')).toBe('repo')
    expect(linkKind('https://gitlab.com/group/project')).toBe('repo')
  })

  it('does not call a deeper forge path a repository', () => {
    expect(linkKind('https://github.com/mariomile/Kore/pull/52')).toBe('link')
    expect(linkKind('https://github.com/mariomile')).toBe('link')
  })

  it('does not mistake a forge site section for an owner', () => {
    expect(linkKind('https://github.com/topics/rust')).toBe('link')
    expect(linkKind('https://github.com/orgs/anthropics')).toBe('link')
  })

  it('reads the filename over the host', () => {
    expect(linkKind('https://www.nytimes.com/report.pdf')).toBe('document')
    expect(linkKind('https://example.com/a/b/photo.JPG')).toBe('image')
    expect(linkKind('https://example.com/talk.mp3')).toBe('audio')
    expect(linkKind('https://example.com/clip.webm')).toBe('video')
  })

  it('reads social and article hosts, subdomains included', () => {
    expect(linkKind('https://x.com/someone/status/1')).toBe('social')
    expect(linkKind('https://someone.substack.com/p/a-post')).toBe('article')
    expect(linkKind('https://en.wikipedia.org/wiki/Kore')).toBe('article')
  })

  it('is not fooled by a lookalike host', () => {
    expect(linkKind('https://notyoutube.com/watch?v=1')).toBe('link')
    expect(linkKind('https://x.com.evil.test/a')).toBe('link')
  })

  it('falls back for anything unrecognised or unparseable', () => {
    expect(linkKind('https://example.com/some/page')).toBe('link')
    expect(linkKind('not a url')).toBe('link')
    expect(linkKind('file:///Users/alex/photo.png')).toBe('link')
  })

  it('gives every kind a label and a tag name', () => {
    expect(linkKindInfo('repo')).toEqual({ label: 'Repository', tag: 'repo' })
    expect(linkKindInfo('social').tag).toBe('post')
  })
})
