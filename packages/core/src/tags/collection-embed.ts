import { isTagName } from '../markdown'
import { isPropertyKey } from './tag-type'

/**
 * Collection embeds (markdown-backed linked databases): a fenced
 * `collection` block in a note body names a typed tag, an optional view, and
 * optional `sort:` / `filter:` lines (Plan 29 V1) — a linked view with its
 * own arrangement. The fence is the portable source of truth — any markdown
 * editor can see and edit every line of it; the app renders a live
 * Collection underneath.
 */

/** Views an embed can ask for. Unknown values fall back to `table`. */
export const COLLECTION_EMBED_VIEWS = ['table', 'grid', 'board', 'calendar'] as const
export type CollectionEmbedView = (typeof COLLECTION_EMBED_VIEWS)[number]

/** `sort: <key> [asc|desc]` — `$title` / `$updated` ride as ordinary keys. */
export interface CollectionEmbedSort {
  readonly key: string
  readonly direction: 'asc' | 'desc'
}

/**
 * One `filter:` line, in the app's filter vocabulary: `is` (`key = value`),
 * `contains` (`key ~ value`), `gt` / `lt` (`key > n`, `key < n`), and the
 * valueless `key is empty` / `key is set`.
 */
export interface CollectionEmbedFilter {
  readonly key: string
  readonly operator: 'is' | 'contains' | 'gt' | 'lt' | 'empty' | 'notEmpty'
  readonly text: string
}

/** The reusable selection rendered by one collection fence. */
export type CollectionEmbedSelection =
  | { readonly kind: 'tag'; readonly tag: string }
  | { readonly kind: 'definition'; readonly reference: string }

/** One collection fence parsed out of a note body. */
export interface CollectionEmbed {
  /** A legacy tag collection or a reusable definition-note reference. */
  readonly selection: CollectionEmbedSelection
  readonly view: CollectionEmbedView
  /** The `sort:` lines in order — a chain, later keys breaking earlier ties. */
  readonly sorts: readonly CollectionEmbedSort[]
  /** `group: <key>` — the table's row grouping (Plan 29 V1b), `null` = flat. */
  readonly group: string | null
  /** The fence's `filter:` lines, in order; malformed lines are skipped. */
  readonly filters: readonly CollectionEmbedFilter[]
  /** `match: any` makes the filters alternatives; the default is every one. */
  readonly match: 'all' | 'any'
  /** Property keys hidden in this inline view; absent keeps every column visible. */
  readonly hidden?: readonly string[]
}

/** `sort:` line value → {@link CollectionEmbedSort}, or null when malformed. */
function parseEmbedSort(value: string): CollectionEmbedSort | null {
  const match = /^(\S+)(?:\s+(asc|desc))?$/i.exec(value.trim())
  if (match === null) {
    return null
  }
  const key = match[1] ?? ''
  if (key === '') {
    return null
  }
  const direction = (match[2] ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  return { key, direction }
}

/** `filter:` line value → {@link CollectionEmbedFilter}, or null when malformed. */
function parseEmbedFilter(value: string): CollectionEmbedFilter | null {
  const valueless = /^(\S+)\s+is\s+(empty|set)$/i.exec(value.trim())
  if (valueless !== null) {
    const key = valueless[1] ?? ''
    return isPropertyKey(key)
      ? { key, operator: valueless[2]?.toLowerCase() === 'set' ? 'notEmpty' : 'empty', text: '' }
      : null
  }
  const compared = /^([^\s=~><]+)\s*([=~><])\s*(.+)$/.exec(value.trim())
  if (compared === null) {
    return null
  }
  const key = compared[1] ?? ''
  const text = (compared[3] ?? '').trim()
  if (!isPropertyKey(key) || text === '') {
    return null
  }
  const operator =
    compared[2] === '='
      ? 'is'
      : compared[2] === '~'
        ? 'contains'
        : compared[2] === '>'
          ? 'gt'
          : 'lt'
  return { key, operator, text }
}

const FENCE_RE = /^```collection[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm

function isCollectionEmbedView(value: string): value is CollectionEmbedView {
  return (COLLECTION_EMBED_VIEWS as readonly string[]).includes(value)
}

export function parseCollectionEmbedBody(body: string): CollectionEmbed | null {
  let selection: CollectionEmbedSelection | null = null
  let view: CollectionEmbedView = 'table'
  const sorts: CollectionEmbedSort[] = []
  let group: string | null = null
  let match: 'all' | 'any' = 'all'
  const filters: CollectionEmbedFilter[] = []
  const hidden: string[] = []
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) {
      // A bare tag names the collection, with or without its `#` — only a
      // `#` line that is NOT a tag reads as a comment.
      const bare = line.replace(/^#/, '')
      if (selection === null && isTagName(bare)) {
        selection = { kind: 'tag', tag: bare }
      }
      continue
    }
    if (line.startsWith('#')) {
      continue
    }
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line
      .slice(colon + 1)
      .trim()
      .replaceAll(/^['"]|['"]$/g, '')
    if (key === 'tag') {
      const tag = value.replace(/^#/, '')
      if (isTagName(tag)) {
        selection = { kind: 'tag', tag }
      }
    } else if (key === 'collection' && value !== '') {
      selection = { kind: 'definition', reference: value }
    } else if (key === 'view' && isCollectionEmbedView(value)) {
      view = value
    } else if (key === 'sort') {
      const sort = parseEmbedSort(value)
      if (sort !== null) {
        sorts.push(sort)
      }
    } else if (key === 'match') {
      match = value.toLowerCase() === 'any' ? 'any' : 'all'
    } else if (key === 'group') {
      // Tolerant like every line: a malformed key is skipped, never the fence.
      group = isPropertyKey(value) ? value : group
    } else if (key === 'filter') {
      const filter = parseEmbedFilter(value)
      if (filter !== null) {
        filters.push(filter)
      }
    } else if (key === 'hide' && isPropertyKey(value) && !hidden.includes(value)) {
      hidden.push(value)
    }
  }
  if (selection === null) {
    return null
  }
  return {
    selection,
    view,
    sorts,
    group,
    filters,
    match,
    ...(hidden.length === 0 ? {} : { hidden }),
  }
}

/**
 * Every well-formed ` ```collection ` fence in `markdown`, in source order.
 * Malformed fences (no tag, illegal tag name) are skipped — they stay
 * visible as code in the editor instead of becoming a broken widget.
 */
export function parseCollectionEmbeds(markdown: string): CollectionEmbed[] {
  const embeds: CollectionEmbed[] = []
  for (const match of markdown.matchAll(FENCE_RE)) {
    const parsed = parseCollectionEmbedBody(match[1] ?? '')
    if (parsed !== null) {
      embeds.push(parsed)
    }
  }
  return embeds
}

/** Serialize one embed as a fence. Defaults (`table`, no sort/filters) are omitted. */
export function formatCollectionEmbed(embed: CollectionEmbed): string {
  return `\`\`\`collection\n${formatCollectionEmbedBody(embed)}\n\`\`\``
}

/** Serialize only the contents of a collection fence. */
export function formatCollectionEmbedBody(embed: CollectionEmbed): string {
  const selection =
    embed.selection.kind === 'tag'
      ? `tag: ${embed.selection.tag}`
      : `collection: ${embed.selection.reference}`
  const lines = [selection]
  if (embed.view !== 'table') {
    lines.push(`view: ${embed.view}`)
  }
  for (const sort of embed.sorts) {
    lines.push(`sort: ${sort.key}${sort.direction === 'desc' ? ' desc' : ''}`)
  }
  if (embed.group !== null) {
    lines.push(`group: ${embed.group}`)
  }
  if (embed.match === 'any') {
    lines.push('match: any')
  }
  for (const filter of embed.filters) {
    if (filter.operator === 'empty' || filter.operator === 'notEmpty') {
      lines.push(`filter: ${filter.key} is ${filter.operator === 'empty' ? 'empty' : 'set'}`)
    } else {
      const glyph =
        filter.operator === 'is'
          ? '='
          : filter.operator === 'contains'
            ? '~'
            : filter.operator === 'gt'
              ? '>'
              : '<'
      lines.push(`filter: ${filter.key} ${glyph} ${filter.text}`)
    }
  }
  for (const key of embed.hidden ?? []) {
    if (isPropertyKey(key)) {
      lines.push(`hide: ${key}`)
    }
  }
  return lines.join('\n')
}
