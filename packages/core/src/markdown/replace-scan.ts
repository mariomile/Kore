import { splitFrontmatter } from './frontmatter'
import type { Span } from './model'

/**
 * Literal find-and-replace over one note's raw markdown.
 *
 * This is written fresh rather than grafted from `unlinked-mentions.ts`,
 * deliberately. Those helpers find the *first* occurrence to render a
 * highlight; the worst a bug there can do is show the wrong snippet. Here the
 * offsets are handed to a writer that overwrites a file, so every shortcut
 * that is harmless in a display helper becomes a way to corrupt a note. The
 * rules below each exist because the display version gets them wrong:
 *
 * - **Case folding is length-preserving.** Folding the haystack with
 *   `toLowerCase()` and then indexing the *raw* string with the result is the
 *   classic offset bug: `String.prototype.toLowerCase` is not length
 *   preserving. Exactly one code point changes UTF-16 length — U+0130 (`İ`)
 *   folds to two units — and one of those in a note shifts every later offset
 *   by one, so the write eats a character. {@link foldPreservingLength} keeps
 *   a code point raw whenever folding would resize it: `İ` then simply does
 *   not case-insensitively match `i`, which is a miss, not a corruption.
 * - **Word boundaries are probed by code point, not code unit.** `text[i]`
 *   returns a lone surrogate next to an astral letter, which is not in
 *   `\p{L}`, so `𝗖at` would read as if `at` started a word.
 * - **`_` counts as a word character.** Stricter than the mentions panel on
 *   purpose: "whole word" is sold as the guard that stops `cat → dog` turning
 *   `category` into `dogegory`, and it has to stop `cat_food_2026` too.
 * - **A note's own title is never prose.** Rewriting the H1 renames the note
 *   and orphans every wiki link pointing at it — a rename dressed up as a
 *   replace. Renaming has its own flow, with link retargeting; this refuses
 *   to do it by accident.
 */

/** Word characters for the boundary test — see the note on `_` above. */
const WORD_CHAR = /[\p{L}\p{N}\p{M}\p{Co}_]/u

/** A byte-order mark, which several markdown probes anchor at index 0 past. */
const BOM = '﻿'

export interface ReplaceScanOptions {
  /** The literal text to find. Never a pattern — there is no regex mode. */
  needle: string
  /** When false, `İ` aside, matching folds case. */
  matchCase: boolean
  /** Require a non-word character (or an edge) on both sides. */
  wholeWord: boolean
}

/**
 * Fold to lowercase without changing any code point's UTF-16 length, so an
 * offset into the folded string is also an offset into the original.
 */
export function foldPreservingLength(text: string): string {
  // ASCII never resizes under folding, and most notes are ASCII: take the
  // native path and keep the per-code-point loop for the rest.
  let ascii = true
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) {
      ascii = false
      break
    }
  }
  if (ascii) {
    return text.toLowerCase()
  }
  let out = ''
  for (const char of text) {
    const lower = char.toLowerCase()
    out += lower.length === char.length ? lower : char
  }
  return out
}

/** The code point ending at `index`, or '' at the start of the text. */
function charBefore(text: string, index: number): string {
  if (index <= 0) {
    return ''
  }
  const unit = text.charCodeAt(index - 1)
  // A low surrogate means the character starts one unit earlier.
  const start = unit >= 0xdc00 && unit <= 0xdfff && index >= 2 ? index - 2 : index - 1
  return text.slice(start, index)
}

/** The code point starting at `index`, or '' at the end of the text. */
function charAfter(text: string, index: number): string {
  if (index >= text.length) {
    return ''
  }
  const unit = text.charCodeAt(index)
  const end = unit >= 0xd800 && unit <= 0xdbff && index + 2 <= text.length ? index + 2 : index + 1
  return text.slice(index, end)
}

function isWordEdge(char: string): boolean {
  return char !== '' && WORD_CHAR.test(char)
}

// ---------------------------------------------------------------------------
// Protected ranges — regions a replace must never rewrite.
// ---------------------------------------------------------------------------

function frontmatterRange(text: string): Span | null {
  // `splitFrontmatter` owns the fence grammar; this only adds BOM tolerance
  // (several probes anchor at index 0, and a BOM would defeat them) and turns
  // the body offset into a protected span.
  const start = text.startsWith(BOM) ? 1 : 0
  const { raw, bodyOffset } = splitFrontmatter(start === 0 ? text : text.slice(start))
  return raw === null ? null : { from: 0, to: start + bodyOffset }
}

/**
 * Fenced code, pairing on the fence's *run length* as CommonMark requires: a
 * closing fence is a run of the same character at least as long as the
 * opening one, with nothing but whitespace after it. Recording only the fence
 * character — the display helper's shortcut — closes a ```` ```` ```` block on
 * the first inner ``` ``` ```` and leaves the rest of the block unprotected.
 */
function fencedCodeRanges(text: string): Span[] {
  const ranges: Span[] = []
  const lineRe = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/gm
  let open: { from: number; char: string; run: number } | null = null
  for (const match of text.matchAll(lineRe)) {
    const fence = match[1]!
    const rest = match[2] ?? ''
    const from = match.index ?? 0
    if (open === null) {
      // An info string may not contain a backtick when the fence is backticks.
      if (fence[0] === '`' && rest.includes('`')) {
        continue
      }
      open = { from, char: fence[0]!, run: fence.length }
      continue
    }
    if (fence[0] === open.char && fence.length >= open.run && rest.trim() === '') {
      ranges.push({ from: open.from, to: from + match[0].length })
      open = null
    }
  }
  if (open !== null) {
    ranges.push({ from: open.from, to: text.length }) // unclosed fence runs to EOF
  }
  return ranges
}

/**
 * Inline code spans, paired by backtick-run length. A greedy `` /`[^`]+`/ ``
 * pairs a stray backtick with the opening tick of a real span, protecting the
 * gap between them and leaving the actual code exposed.
 */
function inlineCodeRanges(text: string): Span[] {
  const ranges: Span[] = []
  const runRe = /`+/g
  let openRun: { from: number; length: number } | null = null
  for (const match of text.matchAll(runRe)) {
    const from = match.index ?? 0
    const length = match[0].length
    if (openRun === null) {
      openRun = { from, length }
      continue
    }
    if (length === openRun.length) {
      ranges.push({ from: openRun.from, to: from + length })
      openRun = null
    }
  }
  return ranges
}

/**
 * Addresses, in every shape markdown writes them. Only the *address* is
 * protected, never the visible text around it: `[the cat](…/cat)` should
 * have its label rewritten and its destination left alone, and the same goes
 * for a wiki link's display label versus its target.
 */
function linkRanges(text: string): Span[] {
  const ranges: Span[] = []

  // [label](destination) / ![alt](destination), one level of nested parens.
  // A label cannot contain `]`, so `](` marks the destination's start exactly.
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\((?:[^()\s]|\([^()\s]*\))*[^)\n]*\)/g)) {
    const from = match.index ?? 0
    const open = match[0].indexOf('](')
    ranges.push({ from: from + open + 2, to: from + match[0].length })
  }

  // A wiki link's target runs to `|` (the display label) or to the closing
  // brackets; the label after a pipe is prose.
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const from = match.index ?? 0
    const inner = match[1] ?? ''
    const pipe = inner.indexOf('|')
    ranges.push({ from, to: from + 2 + (pipe === -1 ? inner.length : pipe) })
  }

  const whole = [
    /<(?:https?|mailto):[^>\s]+>/g, // autolinks
    /\b(?:https?|mailto):\S+/g, // bare URLs
    /^ {0,3}\[[^\]\n]+\]:[ \t]*\S+/gm, // link reference definitions
  ]
  for (const pattern of whole) {
    for (const match of text.matchAll(pattern)) {
      const from = match.index ?? 0
      ranges.push({ from, to: from + match[0].length })
    }
  }
  return ranges
}

/**
 * The line that gives the note its title — the first top-level ATX heading
 * outside protected ranges. Rewriting it is a rename, and a rename that skips
 * the rename pipeline leaves every inbound wiki link pointing at nothing.
 */
function titleRange(text: string, protectedRanges: readonly Span[]): Span | null {
  for (const match of text.matchAll(/^#[ \t][^\n]*$/gm)) {
    const from = match.index ?? 0
    if (!protectedRanges.some((range) => from >= range.from && from < range.to)) {
      return { from, to: from + match[0].length }
    }
  }
  return null
}

function inAnyRange(index: number, ranges: readonly Span[]): boolean {
  return ranges.some((range) => index >= range.from && index < range.to)
}

export interface ReplaceMatch extends Span {
  /** Whether the match was rejected, and why — for the preview's blocked list. */
  skipped: 'code' | 'link' | 'frontmatter' | 'title' | null
}

/**
 * Every occurrence of `needle` in `text`, in raw-markdown coordinates, each
 * flagged with whether a replace may rewrite it. Skipped matches are returned
 * rather than dropped: a preview that silently shows fewer matches than the
 * user can see in the note is a preview that lies.
 */
export function findReplaceMatches(text: string, options: ReplaceScanOptions): ReplaceMatch[] {
  const { needle, matchCase, wholeWord } = options
  if (needle === '') {
    return []
  }
  const haystack = matchCase ? text : foldPreservingLength(text)
  const wanted = matchCase ? needle : foldPreservingLength(needle)
  // Length-preserving folding keeps this true, which is what makes the
  // offsets below safe to hand to a writer.
  if (haystack.length !== text.length || wanted.length !== needle.length) {
    return []
  }

  // In a realistic replace most notes contain no match at all; bail before
  // paying the seven range scans below for a note that yields nothing.
  if (!haystack.includes(wanted)) {
    return []
  }

  const frontmatter = frontmatterRange(text)
  const code = [...fencedCodeRanges(text), ...inlineCodeRanges(text)]
  const links = linkRanges(text)
  const title = titleRange(text, [
    ...(frontmatter === null ? [] : [frontmatter]),
    ...code,
    ...links,
  ])

  const matches: ReplaceMatch[] = []
  let cursor = 0
  for (;;) {
    const from = haystack.indexOf(wanted, cursor)
    if (from === -1) {
      break
    }
    const to = from + wanted.length
    cursor = to // non-overlapping, left-to-right
    if (wholeWord && (isWordEdge(charBefore(text, from)) || isWordEdge(charAfter(text, to)))) {
      continue // inside a longer word: not an occurrence at all, not a skip
    }
    let skipped: ReplaceMatch['skipped'] = null
    if (frontmatter !== null && inAnyRange(from, [frontmatter])) {
      skipped = 'frontmatter'
    } else if (inAnyRange(from, code)) {
      skipped = 'code'
    } else if (inAnyRange(from, links)) {
      skipped = 'link'
    } else if (title !== null && inAnyRange(from, [title])) {
      skipped = 'title'
    }
    matches.push({ from, to, skipped })
  }
  return matches
}

/**
 * `text` with each unskipped match replaced by `replacement`. The
 * replacement is literal:
 * `$&`, `$1` and backslashes go in as typed, because there is no pattern for
 * them to refer back to.
 */
export function applyReplaceMatches(
  text: string,
  matches: readonly ReplaceMatch[],
  replacement: string,
): string {
  const live = matches.filter((match) => match.skipped === null).sort((a, b) => a.from - b.from)
  if (live.length === 0) {
    return text
  }
  // One left-to-right pass: rebuilding the string per match is O(matches ×
  // length), which a long note with a common needle turns into real copying.
  const parts: string[] = []
  let cursor = 0
  for (const match of live) {
    parts.push(text.slice(cursor, match.from), replacement)
    cursor = match.to
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}
