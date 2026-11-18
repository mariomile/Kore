import { splitFrontmatter } from '@kore/core'

/**
 * Exact frontmatter bytes (may be empty) and the body that follows them. The
 * blank lines before the first line of prose ride with the header, whether
 * they follow a frontmatter block (Obsidian writes `---\n\n# Title`) or open
 * a note that has none (what removing the last property leaves): in the body
 * they would open the editor on an empty paragraph above the title. The
 * split stays byte-exact (`header + body === content`), so saving writes the
 * gap back untouched.
 */
export function splitDoc(content: string): { header: string; body: string } {
  const { bodyOffset } = splitFrontmatter(content)
  const gap = /^(?:[ \t]*\r?\n)*/.exec(content.slice(bodyOffset))?.[0].length ?? 0
  const split = bodyOffset + gap
  return { header: content.slice(0, split), body: content.slice(split) }
}
