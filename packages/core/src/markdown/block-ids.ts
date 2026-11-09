/**
 * Obsidian block ids (Plan 33 C3): a `^id` at the end of a line names that
 * line, so `[[Note#^id]]` links to it and `![[Note#^id]]` embeds it. A `^id`
 * alone on a line names the block just above it (how Obsidian ids a table,
 * a quote or a multi-line paragraph). The marker stays in the file, so the
 * Markdown is unchanged and Obsidian reads the same links.
 */

/** Obsidian's id alphabet: letters, digits and dashes. */
const VALID_ID_RE = /^[\da-z-]+$/i
/** A marker at the end of a line, after whitespace or alone on the line. */
const LINE_ID_RE = /(?:^|[ \t])\^([\da-z-]+)[ \t]*$/i
const LINE_IDS_RE = /[ \t]+\^[\da-z-]+[ \t]*$/gim
const ID_ONLY_RE = /^[ \t]*\^[\da-z-]+[ \t]*$/i
const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** True for a string Obsidian accepts as a block id. */
export function isBlockId(id: string): boolean {
  return VALID_ID_RE.test(id)
}

/** The id a line ends with, or null. */
export function lineBlockId(line: string): string | null {
  return LINE_ID_RE.exec(line)?.[1] ?? null
}

/** The `^id` a note link points at (`[[Plan#^a1b2]]`), or null. */
export function noteLinkBlockId(target: string): string | null {
  const hash = target.lastIndexOf('#')
  if (hash === -1) {
    return null
  }
  const fragment = (target.slice(hash + 1).split('|')[0] ?? '').trim()
  if (!fragment.startsWith('^')) {
    return null
  }
  const id = fragment.slice(1)
  return isBlockId(id) ? id : null
}

/** Six lowercase letters or digits: short, and unlikely to repeat in a note. */
export function newBlockId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let index = 0; index < 6; index += 1) {
    id += alphabet[Math.floor(random() * alphabet.length)] ?? 'a'
  }
  return id
}

/** Every block id in `markdown` outside fenced code, in source order. */
export function blockIdsIn(markdown: string): string[] {
  const ids: string[] = []
  for (const { line, fenced } of scanLines(markdown.split('\n'))) {
    const id = fenced ? null : lineBlockId(line)
    if (id !== null) {
      ids.push(id)
    }
  }
  return ids
}

/** `markdown` with every end-of-line `^id` marker removed, for previews. */
export function withoutBlockIds(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !ID_ONLY_RE.test(line))
    .join('\n')
    .replaceAll(LINE_IDS_RE, '')
}

function* scanLines(lines: readonly string[]): Generator<{ line: string; fenced: boolean }> {
  let fence: string | null = null
  for (const line of lines) {
    const open = FENCE_RE.exec(line)?.[1]
    if (fence === null && open !== undefined) {
      fence = open
      yield { line, fenced: true }
      continue
    }
    if (fence !== null) {
      if (line.trim().startsWith(fence[0]!.repeat(fence.length))) {
        fence = null
      }
      yield { line, fenced: true }
      continue
    }
    yield { line, fenced: false }
  }
}

function indentOf(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').replaceAll('\t', '    ').length
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

const HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/

/** A line that ends a paragraph run: blank, or a heading (its own block). */
function isBoundary(line: string): boolean {
  return isBlank(line) || HEADING_RE.test(line)
}

/** The paragraph-like run of non-blank lines around `index`. */
function runAround(lines: readonly string[], index: number): [number, number] {
  let from = index
  if (HEADING_RE.test(lines[index]!)) {
    return [index, index + 1]
  }
  while (from > 0 && !isBoundary(lines[from - 1]!)) {
    from -= 1
  }
  let to = index + 1
  while (to < lines.length && !isBoundary(lines[to]!)) {
    to += 1
  }
  return [from, to]
}

/** A list item's line through its last nested line. */
function itemBranch(lines: readonly string[], index: number): [number, number] {
  const indent = indentOf(lines[index]!)
  let to = index + 1
  let end = to
  while (to < lines.length) {
    const line = lines[to]!
    if (!isBlank(line)) {
      if (indentOf(line) <= indent) {
        break
      }
      end = to + 1
    }
    to += 1
  }
  return [index, end]
}

function dedent(lines: readonly string[], by: number): string[] {
  return lines.map((line) => {
    let removed = 0
    let at = 0
    while (at < line.length && removed < by && (line[at] === ' ' || line[at] === '\t')) {
      removed += line[at] === '\t' ? 4 : 1
      at += 1
    }
    return line.slice(at)
  })
}

/**
 * The Markdown a `^id` names in `source`: a list item with its children, a
 * paragraph, or (for an id alone on its line) the block above it. Markers are
 * removed from the result. Null when no line carries `id`.
 */
export function extractBlockSection(source: string, id: string): string | null {
  const lines = source.split('\n')
  let index = -1
  for (const [at, entry] of [...scanLines(lines)].entries()) {
    if (!entry.fenced && lineBlockId(entry.line) === id) {
      index = at
      break
    }
  }
  if (index === -1) {
    return null
  }
  let range: [number, number]
  if (ID_ONLY_RE.test(lines[index]!)) {
    let above = index - 1
    while (above >= 0 && isBlank(lines[above]!)) {
      above -= 1
    }
    if (above < 0) {
      return null
    }
    range = [runAround(lines, above)[0], above + 1]
  } else if (LIST_ITEM_RE.test(lines[index]!)) {
    range = itemBranch(lines, index)
  } else {
    range = runAround(lines, index)
  }
  const indent = LIST_ITEM_RE.test(lines[range[0]]!) ? indentOf(lines[range[0]]!) : 0
  const slice = withoutBlockIds(dedent(lines.slice(range[0], range[1]), indent).join('\n')).trim()
  return slice === '' ? null : slice
}

/**
 * The label a `[[Note#^id]]` shows wherever Kore draws it: the note's name,
 * never the id, which means nothing to a reader. An alias
 * (`[[Note#^id|text]]`) wins, and a same-note `[[#^id]]` reads "Link to
 * line". Null for any link that is not a block reference.
 */
export function blockLinkLabel(target: string): string | null {
  if (noteLinkBlockId(target) === null) {
    return null
  }
  const pipe = target.indexOf('|')
  const alias = pipe === -1 ? '' : target.slice(pipe + 1).trim()
  if (alias !== '') {
    return alias
  }
  const link = pipe === -1 ? target : target.slice(0, pipe)
  const note = link.slice(0, link.lastIndexOf('#')).trim()
  return note === '' ? 'Link to line' : note
}
