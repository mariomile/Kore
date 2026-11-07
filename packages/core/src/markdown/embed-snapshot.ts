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

/**
 * The text a saved post-embed comment stands for, or `null` when `comment`
 * is not one (any other HTML comment stays the note's own text).
 */
export function embedSnapshotText(comment: string): string | null {
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
  if (!isObject(data)) {
    return null
  }
  const words: string[] = []
  if (kind === 'x-post') {
    words.push(...xPostWords(data), ...xPostWords(data.quote))
  } else if (kind === 'youtube-video') {
    for (const field of [data.title, data.author_name]) {
      const value = text(field)
      if (value !== null) words.push(value)
    }
  } else {
    return null
  }
  return words.join(' ')
}
