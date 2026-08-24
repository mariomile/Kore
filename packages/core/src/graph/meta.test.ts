import { describe, expect, it } from 'vitest'
import { parseNote } from '../markdown'
import { GRAPH_META_PATH } from './paths'
import {
  GRAPH_META_MARKER,
  graphMetaSource,
  isGraphMetaNote,
  isGraphMetaPath,
  parseGraphMetaFrontmatter,
} from './meta'

describe('graph meta', () => {
  it('recognizes only the root graph.md path', () => {
    expect(isGraphMetaPath(GRAPH_META_PATH)).toBe(true)
    expect(isGraphMetaPath('notes/graph.md')).toBe(false)
    expect(isGraphMetaPath('graph.MD')).toBe(false)
  })

  it('round-trips a company role through markdown', () => {
    const source = graphMetaSource('company')
    const parsed = parseNote({ path: GRAPH_META_PATH, source })
    expect(parsed.frontmatter['lore']).toBe(GRAPH_META_MARKER)
    expect(parseGraphMetaFrontmatter(parsed.frontmatter)).toBe('company')
    expect(isGraphMetaNote(GRAPH_META_PATH, parsed.frontmatter)).toBe(true)
    expect(source).toContain('named notes')
    expect(source).toContain('does **not** hide')
  })

  it('round-trips a personal role and ignores unmarked files', () => {
    const source = graphMetaSource('personal')
    const parsed = parseNote({ path: GRAPH_META_PATH, source })
    expect(parseGraphMetaFrontmatter(parsed.frontmatter)).toBe('personal')
    expect(isGraphMetaNote('notes/other.md', parsed.frontmatter)).toBe(false)
    expect(parseGraphMetaFrontmatter({ lore: 'tag', role: 'company' })).toBe(null)
    expect(parseGraphMetaFrontmatter({ lore: 'graph', role: 'team' })).toBe(null)
  })
})
