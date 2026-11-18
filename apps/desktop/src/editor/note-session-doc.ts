import { splitFrontmatter } from '@kore/core'

/**
 * Exact frontmatter bytes (may be empty) and the body that follows them. The
 * blank lines between a frontmatter block and the first line of prose ride
 * with the header: Obsidian writes `---\n\n# Title`, and in the body that
 * gap would open the editor on an empty paragraph above the title. The split
 * stays byte-exact (`header + body === content`), so saving writes the gap
 * back untouched.
 */
export function splitDoc(content: string): { header: string; body: string } {
  const { body, bodyOffset } = splitFrontmatter(content)
  if (bodyOffset === 0) {
    return { header: '', body }
  }
  const gap = /^(?:[ \t]*\r?\n)*/.exec(content.slice(bodyOffset))?.[0].length ?? 0
  const split = bodyOffset + gap
  return { header: content.slice(0, split), body: content.slice(split) }
}
