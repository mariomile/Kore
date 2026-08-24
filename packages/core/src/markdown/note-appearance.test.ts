import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './frontmatter'
import {
  parseNoteAppearance,
  parseNoteAppearanceFromSource,
  parseNoteCover,
  parseNoteIcon,
} from './note-appearance'
import { isPropertyKey } from '../tags/tag-type'

describe('parseNoteIcon', () => {
  it('accepts a short glyph and an image path or wiki embed', () => {
    expect(parseNoteIcon('✨')).toEqual({ kind: 'emoji', glyph: '✨' })
    expect(parseNoteIcon('📚')).toEqual({ kind: 'emoji', glyph: '📚' })
    expect(parseNoteIcon('A')).toEqual({ kind: 'emoji', glyph: 'A' })
    expect(parseNoteIcon('assets/icon.png')).toEqual({
      kind: 'image',
      src: 'assets/icon.png',
    })
    expect(parseNoteIcon('![[assets/icon.png]]')).toEqual({
      kind: 'image',
      src: 'assets/icon.png',
    })
    expect(parseNoteIcon('https://example.com/i.png')).toEqual({
      kind: 'image',
      src: 'https://example.com/i.png',
    })
  })

  it('rejects empty values, non-images, and non-http URLs', () => {
    expect(parseNoteIcon('')).toBeNull()
    expect(parseNoteIcon('   ')).toBeNull()
    expect(parseNoteIcon(1)).toBeNull()
    expect(parseNoteIcon('assets/notes.pdf')).toBeNull()
    expect(parseNoteIcon('javascript:alert(1)')).toBeNull()
    expect(parseNoteIcon('file:///etc/passwd')).toBeNull()
    expect(parseNoteIcon('this is far too long to be an icon glyph')).toBeNull()
    expect(parseNoteIcon('folder/not-an-image')).toBeNull()
  })
})

describe('parseNoteCover', () => {
  it('accepts image paths, wiki embeds, and http(s) URLs', () => {
    expect(parseNoteCover('assets/cover.jpg')).toBe('assets/cover.jpg')
    expect(parseNoteCover('![[assets/cover.jpg]]')).toBe('assets/cover.jpg')
    expect(parseNoteCover('[[assets/cover.webp]]')).toBe('assets/cover.webp')
    expect(parseNoteCover('https://example.com/c.png')).toBe('https://example.com/c.png')
  })

  it('rejects non-images and non-http URLs', () => {
    expect(parseNoteCover('')).toBeNull()
    expect(parseNoteCover('My Note')).toBeNull()
    expect(parseNoteCover('assets/notes.pdf')).toBeNull()
    expect(parseNoteCover('javascript:alert(1)')).toBeNull()
  })
})

describe('parseNoteAppearance', () => {
  it('reads cover and icon from frontmatter', () => {
    const { data } = parseFrontmatter('icon: ✨\ncover: assets/hero.png\naliases:\n  - x')
    expect(parseNoteAppearance(data)).toEqual({
      icon: { kind: 'emoji', glyph: '✨' },
      coverSrc: 'assets/hero.png',
    })
  })

  it('parses from a fenced header (the editor session’s exact bytes)', () => {
    expect(
      parseNoteAppearanceFromSource('---\nicon: 📚\ncover: "![[assets/c.png]]"\n---\n# Body\n'),
    ).toEqual({
      icon: { kind: 'emoji', glyph: '📚' },
      coverSrc: 'assets/c.png',
    })
    expect(parseNoteAppearanceFromSource('# Body only\n')).toEqual({
      icon: null,
      coverSrc: null,
    })
  })
})

describe('reserved appearance keys', () => {
  it('refuses cover and icon as tag-property keys', () => {
    expect(isPropertyKey('cover')).toBe(false)
    expect(isPropertyKey('icon')).toBe(false)
    expect(isPropertyKey('author')).toBe(true)
  })
})
