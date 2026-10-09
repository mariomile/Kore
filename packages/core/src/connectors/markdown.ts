import { Document } from 'yaml'

/** Characters no filename may carry, plus the ones wiki links reserve. */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|#^[\]\p{Cc}]/gu

/** Long titles are cut here; the full title stays in the H1. */
const MAX_STEM_LENGTH = 120

/**
 * A readable, filesystem-safe filename stem for `title`: spaces kept (the
 * Obsidian-style naming connector notes follow), unsafe characters dropped,
 * whitespace collapsed, no leading dot. Falls back to `fallback`, cleaned the
 * same way (it often carries a remote id), when nothing printable is left.
 */
export function connectorFileStem(title: string, fallback: string): string {
  return cleanStem(title) || cleanStem(fallback) || 'Untitled'
}

function cleanStem(text: string): string {
  return text
    .replaceAll(UNSAFE_FILENAME_CHARS, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, MAX_STEM_LENGTH)
    .trim()
}

/** A title safe to use as a one-line H1. */
export function headingText(title: string): string {
  return title.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Serialize a note: a YAML frontmatter block (keys in the given order,
 * `undefined` and empty lists dropped) followed by `body`.
 */
export function noteWithFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const defined = Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  )
  const yaml = String(new Document(defined))
  return `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n${body}`
}

/**
 * Indent every line after the first so multi-line text stays inside a list
 * item (`- first\n  second`).
 */
export function indentContinuation(text: string, indent: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line, index) => (index === 0 || line.trim() === '' ? line.trimEnd() : `${indent}${line}`))
    .join('\n')
}

/** Append `block` to `source`, separated by exactly one blank line. */
export function appendBlock(source: string, block: string): string {
  return `${source.replace(/\s*$/, '')}\n\n${block.trim()}\n`
}
