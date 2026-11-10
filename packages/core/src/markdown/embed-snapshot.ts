/**
 * The words of a saved post embed. Meowdown saves what an X or YouTube card
 * shows into the comment after its image, `![](url)<!-- {"snapshot":…} -->`,
 * so the card renders without the network. That comment is JSON: read as
 * prose it would put keys, avatar URLs and `\n` escapes into search. This
 * reads it as the card does instead, so a note answers to the post's author
 * and words, and the AI's note text carries the post rather than its JSON.
 */

const MAGIC_COMMENT = /^<!--\s*(\{[\s\S]*\})\s*-->$/

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** `Name @handle`, then the body, of an X post or the post it quotes. */
function xPostWords(post: unknown): string[] {
  if (!isObject(post)) {
    return []
  }
  const words: string[] = []
  if (isObject(post.author)) {
    const name = text(post.author.name)
    const handle = text(post.author.handle)
    if (name !== null) words.push(name)
    if (handle !== null) words.push(`@${handle}`)
  }
  if (Array.isArray(post.body)) {
    const body = post.body
      .map((segment) => (isObject(segment) ? (text(segment.text) ?? '') : ''))
      .join('')
    if (body.trim() !== '') words.push(body)
  }
  return words
}

type EmbedSnapshot = { kind: 'x-post'; data: Json } | { kind: 'youtube-video'; data: Json }

/** The snapshot a saved post-embed comment carries, or `null` for any other comment. */
function readEmbedSnapshot(comment: string): EmbedSnapshot | null {
  const match = MAGIC_COMMENT.exec(comment.trim())
  if (match === null) {
    return null
  }
  let magic: unknown
  try {
    magic = JSON.parse(match[1] ?? '')
  } catch {
    return null
  }
  if (!isObject(magic) || !isObject(magic.snapshot)) {
    return null
  }
  const { kind, data } = magic.snapshot
  if (!isObject(data) || (kind !== 'x-post' && kind !== 'youtube-video')) {
    return null
  }
  return { kind, data }
}

/**
 * The text a saved post-embed comment stands for, or `null` when `comment`
 * is not one (any other HTML comment stays the note's own text).
 */
export function embedSnapshotText(comment: string): string | null {
  const snapshot = readEmbedSnapshot(comment)
  if (snapshot === null) {
    return null
  }
  const { kind, data } = snapshot
  const words: string[] = []
  if (kind === 'x-post') {
    words.push(...xPostWords(data), ...xPostWords(data.quote))
  } else {
    for (const field of [data.title, data.author_name]) {
      const value = text(field)
      if (value !== null) words.push(value)
    }
  }
  return words.join(' ')
}

/** `> **Name** @handle` then the post's lines, as a markdown quote. */
function xPostQuote(post: unknown): string[] {
  if (!isObject(post)) {
    return []
  }
  const lines: string[] = []
  if (isObject(post.author)) {
    const name = text(post.author.name)
    const handle = text(post.author.handle)
    const byline = [
      name === null ? null : `**${name.trim()}**`,
      handle === null ? null : `@${handle}`,
    ]
      .filter((part) => part !== null)
      .join(' ')
    if (byline !== '') lines.push(byline)
  }
  if (Array.isArray(post.body)) {
    const body = post.body
      .map((segment) => (isObject(segment) ? (text(segment.text) ?? '') : ''))
      .join('')
      .trim()
    if (body !== '') lines.push(...body.split('\n').filter((line) => line.trim() !== ''))
  }
  return lines.map((line) => `> ${line}`)
}

function snapshotMarkdown(snapshot: EmbedSnapshot): string | null {
  const { kind, data } = snapshot
  let lines: string[]
  if (kind === 'x-post') {
    lines = xPostQuote(data)
    const quoted = xPostQuote(data.quote)
    if (quoted.length > 0) lines.push('>', ...quoted.map((line) => `> ${line}`))
  } else {
    const title = text(data.title)
    const channel = text(data.author_name)
    lines = [
      title === null ? null : `> **${title.trim()}**`,
      channel === null ? null : `> ${channel}`,
    ].filter((line) => line !== null)
  }
  return lines.length === 0 ? null : lines.join('\n')
}

/** A saved embed: its optional leading image, then the snapshot comment. */
const SAVED_EMBED = /(?:!\[[^\]\n]*\]\([^)\n]*\))?(<!--[\s\S]*?-->)/g

/**
 * `markdown` with every saved X/YouTube embed (`![](url)<!-- {"snapshot":…} -->`)
 * swapped for a markdown quote of what its card shows: the author and the
 * post, or the video's title and channel. For passive previews (the All notes
 * cards), which load no remote embed, so the comment would otherwise surface
 * as raw JSON. Any other comment, and an embed whose snapshot can't be read,
 * stays as written.
 */
export function inlineEmbedSnapshots(markdown: string): string {
  if (!markdown.includes('"snapshot"')) {
    return markdown
  }
  return markdown.replaceAll(SAVED_EMBED, (whole: string, comment: string) => {
    const snapshot = readEmbedSnapshot(comment)
    const quote = snapshot === null ? null : snapshotMarkdown(snapshot)
    return quote === null ? whole : `\n\n${quote}\n\n`
  })
}
