/**
 * Agent tools give many files the same fixed name (`SKILL.md`, `AGENTS.md`,
 * `README.md`), so a tab titled by the file name alone would read "SKILL"
 * ten times over. Those take their folder's name instead.
 */
const GENERIC_NAMES = new Set(['skill', 'agents', 'claude', 'readme', 'index', 'gemini'])

/** The title a Library file shows in its tab and header. */
export function libraryFileTitle(path: string): string {
  const parts = path.split('/').filter((part) => part !== '')
  const file = parts.at(-1) ?? path
  const name = file.replace(/\.md$/i, '')
  const parent = parts.at(-2)
  return GENERIC_NAMES.has(name.toLowerCase()) && parent !== undefined ? parent : name
}
