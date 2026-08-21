/**
 * Note directives: the model can put `::note{path="notes/x.md"}` on a line
 * of its own and the chat renderer promotes that line to an interactive
 * card that opens the note. The stored transcript stays portable markdown —
 * only the renderer promotes the directive, so a copied or exported reply
 * degrades to a readable line instead of losing information.
 *
 * The path attribute is model-authored and therefore untrusted: a directive
 * whose path fails {@link isSafeNoteDirectivePath} is left in the text as
 * plain markdown rather than becoming a clickable card.
 */

export interface NoteDirectiveMarkdownSegment {
  kind: 'markdown'
  text: string
}

export interface NoteDirectiveNoteSegment {
  kind: 'note'
  /** Validated graph-relative note path, e.g. `notes/atlas.md`. */
  path: string
}

export type NoteDirectiveSegment = NoteDirectiveMarkdownSegment | NoteDirectiveNoteSegment

/** A whole line of its own, like markdown's own block directives. */
const DIRECTIVE_LINE = /^\s{0,3}::note\{path="([^"]+)"\}\s*$/

/**
 * Only a plain graph-relative markdown path becomes a card: no absolute
 * paths, drive letters, backslashes, `.`/`..` segments, or empty segments —
 * the same shape every vault tool accepts.
 */
export function isSafeNoteDirectivePath(path: string): boolean {
  if (path === '' || path.length > 512) {
    return false
  }
  if (path.startsWith('/') || path.includes('\\') || /^[A-Z]:/i.test(path)) {
    return false
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false
  }
  return path.toLowerCase().endsWith('.md')
}

/**
 * Split settled reply markdown into markdown runs and note-card directives.
 * Directives inside fenced code blocks stay literal — a reply *about* the
 * syntax must be able to show it without spawning cards.
 */
export function parseNoteDirectives(markdown: string): NoteDirectiveSegment[] {
  const segments: NoteDirectiveSegment[] = []
  let buffer: string[] = []
  const flush = (): void => {
    const text = buffer.join('\n')
    if (text.trim() !== '') {
      segments.push({ kind: 'markdown', text })
    }
    buffer = []
  }
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inFence = !inFence
      buffer.push(line)
      continue
    }
    const path = inFence ? undefined : DIRECTIVE_LINE.exec(line)?.[1]
    if (path !== undefined && isSafeNoteDirectivePath(path)) {
      flush()
      segments.push({ kind: 'note', path })
    } else {
      buffer.push(line)
    }
  }
  flush()
  return segments
}

/** Display title for a note card: the file name, extension dropped. */
export function noteDirectiveTitle(path: string): string {
  const name = path.split('/').at(-1) ?? path
  return name.replace(/\.md$/i, '')
}
