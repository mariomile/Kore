import { readWikiLinks, type PropertyValue } from './property-values'
import { relationValue, type TagProperty } from './tag-type'

/**
 * "This note" in a collection fence (organization point 5): a `filter:` line
 * whose value is the keyword `this` points at the note the fence sits in.
 * `filter: project = this` in the `#project` template gives every project
 * its own "tasks of this project" table without naming the note, so the
 * fence stays the same in every copy and readable on disk.
 */
export const THIS_NOTE_FILTER_TEXT = 'this'

/** The note a collection fence is rendered inside. */
export interface EmbedHostNote {
  /** Vault-relative path, e.g. `Projects/Atlas.md`. */
  readonly path: string
  /** The wiki-link target other notes use for it (title form), or null. */
  readonly linkTarget: string | null
}

/** Whether this filter value means "the note this fence is in". */
export function isThisNoteFilterText(text: string): boolean {
  return text.trim().toLowerCase() === THIS_NOTE_FILTER_TEXT
}

/** The property types a "this note" filter can compare: links to notes. */
export function acceptsThisNoteFilter(property: TagProperty): boolean {
  return property.type === 'relation' || property.type === 'relations'
}

function fold(text: string): string {
  return text.trim().toLowerCase()
}

/** The names a link may use for the host: its title target, its path, its file name. */
function hostNames(host: EmbedHostNote): Set<string> {
  const names = new Set<string>()
  const withoutExtension = host.path.replace(/\.md$/i, '')
  names.add(fold(withoutExtension))
  names.add(fold(withoutExtension.split('/').pop() ?? withoutExtension))
  if (host.linkTarget !== null && host.linkTarget.trim() !== '') {
    names.add(fold(host.linkTarget))
  }
  return names
}

/** A link target without its `#heading` / `^block` part or a `.md` suffix. */
function bareTarget(target: string): string {
  return target.replace(/[#^].*$/, '').replace(/\.md$/i, '')
}

/**
 * Whether a stored relation value links to the host note: any of its
 * `[[links]]` names the host by title, path or file name (case-insensitive,
 * like wiki-link resolution). Non-link values never match.
 */
export function linksToHostNote(value: PropertyValue | undefined, host: EmbedHostNote): boolean {
  if (value === undefined) {
    return false
  }
  const links = readWikiLinks(value)
  if (links === null || links.length === 0) {
    return false
  }
  const names = hostNames(host)
  return links.some((link) => names.has(fold(bareTarget(link.target))))
}

/**
 * The frontmatter a row created from a fence should be born with, so it
 * lands inside the view it was added from: each `key = this` filter on a
 * relation field becomes a link to the host (a list for a multi-relation).
 * Hosts without a link target (an untitled note) add nothing.
 */
export function hostStartingValues(
  filters: readonly { readonly key: string; readonly operator: string; readonly text: string }[],
  properties: readonly TagProperty[],
  host: EmbedHostNote,
): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {}
  if (host.linkTarget === null || host.linkTarget.trim() === '') {
    return values
  }
  const link = relationValue(host.linkTarget)
  for (const filter of filters) {
    if (filter.operator !== 'is' || !isThisNoteFilterText(filter.text)) {
      continue
    }
    const property = properties.find((candidate) => candidate.key === filter.key)
    if (property === undefined || !acceptsThisNoteFilter(property)) {
      continue
    }
    values[property.key] = property.type === 'relations' ? [link] : link
  }
  return values
}

const INLINE_WIKI_LINK = /\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g

/**
 * Whether a checkbox line's text links to the host note: a task written in a
 * daily as `- [ ] call Luca #task [[Project X]]` belongs to Project X's
 * "tasks of this note" view as much as one written inside it.
 */
export function textLinksToHostNote(text: string, host: EmbedHostNote): boolean {
  if (!text.includes('[[')) {
    return false
  }
  const names = hostNames(host)
  for (const match of text.matchAll(INLINE_WIKI_LINK)) {
    const target = match[1]
    if (target !== undefined && names.has(fold(bareTarget(target)))) {
      return true
    }
  }
  return false
}

/** Whether a fence has any `key = this` filter, so it is a "this note" view. */
export function hasThisNoteFilter(
  filters: readonly { readonly operator: string; readonly text: string }[],
): boolean {
  return filters.some((filter) => filter.operator === 'is' && isThisNoteFilterText(filter.text))
}
