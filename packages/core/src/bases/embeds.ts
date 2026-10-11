/**
 * `![[Name.base]]` and `![[Name.base#View]]` embeds in a note body: the
 * Obsidian way to put a live base view inside a note (a Home dashboard).
 */

/** One base embed: the `.base` target as written and the view name, if any. */
export interface BaseEmbed {
  /** Target as written, e.g. `Today.base` or `_system/views/Today.base`. */
  readonly target: string
  /** View name after `#`, or null for the base's first view. */
  readonly view: string | null
}

const EMBED_RE = /!\[\[([^\]\n]+?\.base)(?:#([^\]|\n]*))?(?:\|[^\]\n]*)?\]\]/gi

function withoutCode(markdown: string): string {
  return markdown.replaceAll(/```[\s\S]*?```/g, '').replaceAll(/`[^`]*`/g, '')
}

/** Every base embed in `markdown`, in source order, skipping code. */
export function parseBaseEmbeds(markdown: string): BaseEmbed[] {
  return [...withoutCode(markdown).matchAll(EMBED_RE)].map((match) => {
    const view = (match[2] ?? '').trim()
    return { target: match[1]!.trim(), view: view === '' ? null : view }
  })
}

/** Whether a graph-relative path or link target names a `.base` file. */
export function isBasePath(path: string): boolean {
  return /\.base$/i.test(path.split('#')[0]!.trim())
}

/** Display name of a base file: its file name without `.base`. */
export function baseDisplayName(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.base$/i, '')
}
