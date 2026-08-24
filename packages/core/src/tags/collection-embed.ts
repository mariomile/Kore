import { isTagName } from '../markdown'

/**
 * Collection embeds (markdown-backed linked databases): a fenced
 * `collection` block in a note body names a typed tag and an optional view.
 * The fence is the portable source of truth — any markdown editor can see
 * it; the app renders a live Collection underneath.
 */

/** Views an embed can ask for. Unknown values fall back to `table`. */
export const COLLECTION_EMBED_VIEWS = ['table', 'board', 'calendar'] as const
export type CollectionEmbedView = (typeof COLLECTION_EMBED_VIEWS)[number]

/** One collection fence parsed out of a note body. */
export interface CollectionEmbed {
  /** Tag name as authored (without `#`). */
  readonly tag: string
  readonly view: CollectionEmbedView
}

const FENCE_RE = /^```collection[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm

function isCollectionEmbedView(value: string): value is CollectionEmbedView {
  return (COLLECTION_EMBED_VIEWS as readonly string[]).includes(value)
}

function parseCollectionEmbedBody(body: string): CollectionEmbed | null {
  let tag = ''
  let view: CollectionEmbedView = 'table'
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) {
      const bare = line.replace(/^#/, '')
      if (tag === '' && isTagName(bare)) {
        tag = bare
      }
      continue
    }
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line
      .slice(colon + 1)
      .trim()
      .replaceAll(/^['"]|['"]$/g, '')
    if (key === 'tag') {
      tag = value.replace(/^#/, '')
    } else if (key === 'view' && isCollectionEmbedView(value)) {
      view = value
    }
  }
  if (!isTagName(tag)) {
    return null
  }
  return { tag, view }
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

/** Serialize one embed as a fence. `table` is the default and is omitted. */
export function formatCollectionEmbed(embed: CollectionEmbed): string {
  const lines = ['```collection', `tag: ${embed.tag}`]
  if (embed.view !== 'table') {
    lines.push(`view: ${embed.view}`)
  }
  lines.push('```')
  return lines.join('\n')
}
