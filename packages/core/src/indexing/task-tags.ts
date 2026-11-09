import { inlineTagNames, isTagName } from '../markdown/extract'
import { foldTag } from '../markdown/keys'

/**
 * Filtering tasks by `#tag` (Todoist's labels): a `#name` token in the Tasks
 * search box narrows every view to the tasks whose own line carries that tag,
 * and the filters menu lists the tags the open tasks use. A parent tag matches
 * its children, as everywhere tags nest: `#work` keeps `#work/kore`.
 */

/** A Tasks search, split into its `#tag` filters and its free text. */
export interface TaskQuery {
  /** The free text, trimmed and lowercased (empty = no text filter). */
  readonly text: string
  /** The `#tag` tokens, folded, in the order typed. */
  readonly tags: readonly string[]
}

/** A tag the open tasks use, with how many carry it. */
export interface TaskTagCount {
  /** First-seen spelling, for display. */
  readonly tag: string
  /** The folded match key. */
  readonly key: string
  readonly count: number
}

function isTagToken(token: string): boolean {
  return token.length > 1 && token.startsWith('#') && isTagName(token.slice(1))
}

/** Split a search into `#tag` filters and free text. */
export function parseTaskQuery(query: string): TaskQuery {
  const tags: string[] = []
  const words: string[] = []
  for (const token of query.trim().split(/\s+/)) {
    if (isTagToken(token)) {
      const key = foldTag(token.slice(1))
      if (!tags.includes(key)) {
        tags.push(key)
      }
    } else if (token !== '') {
      words.push(token)
    }
  }
  return { text: words.join(' ').toLowerCase(), tags }
}

/** The folded tags a task's own line carries. */
export function taskTagKeys(task: { readonly raw: string }): string[] {
  return inlineTagNames(task.raw).map(foldTag)
}

function tagCovers(filter: string, tag: string): boolean {
  return tag === filter || tag.startsWith(`${filter}/`)
}

/** Does the task carry every tag in `tags` (or a child of it)? */
export function taskHasTags(task: { readonly raw: string }, tags: readonly string[]): boolean {
  if (tags.length === 0) {
    return true
  }
  const own = taskTagKeys(task)
  return tags.every((filter) => own.some((tag) => tagCovers(filter, tag)))
}

/** The tags the tasks use, most used first, then A→Z. */
export function countTaskTags(tasks: readonly { readonly raw: string }[]): TaskTagCount[] {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const task of tasks) {
    for (const tag of inlineTagNames(task.raw)) {
      const key = foldTag(tag)
      const entry = counts.get(key)
      if (entry === undefined) {
        counts.set(key, { tag, count: 1 })
      } else {
        entry.count += 1
      }
    }
  }
  return [...counts.entries()]
    .map(([key, { tag, count }]) => ({ tag, key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** Add `#tag` to the search, or take it out when it is already there. */
export function toggleQueryTag(query: string, tag: string): string {
  const key = foldTag(tag)
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '')
  const kept = tokens.filter((token) => !(isTagToken(token) && foldTag(token.slice(1)) === key))
  if (kept.length === tokens.length) {
    kept.push(`#${tag}`)
  }
  return kept.join(' ')
}
