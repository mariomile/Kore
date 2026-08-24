import { z } from 'zod'
import { upsertFrontmatter, type Frontmatter } from '../markdown'
import { GRAPH_META_PATH } from './paths'

/**
 * Graph identity (personal vs company brain). Lives in `graph.md` at the
 * vault root with a `lore: graph` marker — the same markdown-in-graph
 * pattern as tag types. Recents and settings may cache the role for the
 * switcher; this file is what syncs.
 */

/** The `lore:` frontmatter value that marks `graph.md` as graph identity. */
export const GRAPH_META_MARKER = 'graph'

/** How this graph is meant to be used. */
export const graphRoleSchema = z.enum(['personal', 'company'])
export type GraphRole = z.infer<typeof graphRoleSchema>

/** Is this the graph identity path (`graph.md`)? */
export function isGraphMetaPath(path: string): boolean {
  return path === GRAPH_META_PATH
}

/**
 * Read a graph role out of `graph.md` frontmatter, or `null` when the
 * marker is absent or the role is missing/invalid. Tolerant like every
 * frontmatter read: a malformed file never throws.
 */
export function parseGraphMetaFrontmatter(frontmatter: Frontmatter): GraphRole | null {
  if (frontmatter['lore'] !== GRAPH_META_MARKER) {
    return null
  }
  const parsed = graphRoleSchema.safeParse(frontmatter['role'])
  return parsed.success ? parsed.data : null
}

/** Is this note the graph identity file (path + marker)? */
export function isGraphMetaNote(path: string, frontmatter: Frontmatter): boolean {
  return isGraphMetaPath(path) && frontmatter['lore'] === GRAPH_META_MARKER
}

/**
 * On-disk source for `graph.md`. The body is user-visible on purpose: it
 * explains the capture rule and that `private: true` is not a sync lock.
 */
export function graphMetaSource(role: GraphRole): string {
  const body =
    role === 'company'
      ? [
          '# Company brain',
          '',
          'Capture decisions, meetings, people, and projects as **named notes**.',
          'Do not treat `daily/` as a shared team diary — several people writing',
          'the same day will conflict.',
          '',
          'Lock (`private: true`) keeps a note out of AI. It does **not** hide it',
          'from GitHub or iCloud. Personal thoughts belong in a personal graph.',
          '',
        ].join('\n')
      : [
          '# Personal notes',
          '',
          'Today’s daily note is the capture surface. Link people, projects, and',
          'ideas as you write.',
          '',
          'Lock (`private: true`) keeps a note out of AI. Backup and sync still',
          'include it — a lock is not encryption.',
          '',
        ].join('\n')
  return upsertFrontmatter(body, { lore: GRAPH_META_MARKER, role })
}
