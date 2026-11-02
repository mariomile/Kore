import { wikiNoteReference } from '../graph/note-reference'
import { foldGraphPath } from '../graph/paths'
import { attachmentReferenceCandidates, isAttachmentEmbedTarget } from '../markdown/asset-paths'
import { parseNote } from '../markdown/extract'
import { applySplices, type Splice } from '../markdown/retitle'
import type { ImportLinkMap } from './plan'

/** One note's links after the import's moves. */
export interface ImportLinkRewrite {
  readonly source: string
  /** Links whose target changed. */
  readonly links: number
}

const WIKI_SPAN_RE = /^\[\[([\s\S]*)\]\]$/
/** `[text](href rest)` / `![alt](<href> "title")`: prefix, href, suffix. */
const MARKDOWN_LINK_RE = /^(!?\[[\s\S]*\]\(\s*)(<[^>\n]*>|[^\s)]+)([\s\S]*\))$/

/**
 * A wiki target's new spelling, or `null` when the move map doesn't touch it.
 * Links to a daily become Kore's date link (`[[2026-10-09]]`, whether they
 * named the daily by path or by its old file name); links to a moved template
 * or attachment by path follow it. A bare attachment name stays as written:
 * the file keeps its name and still resolves by it.
 */
function nextWikiTarget(targetPath: string, map: ImportLinkMap): string | null {
  if (isAttachmentEmbedTarget(targetPath)) {
    const move = map.byPath.get(foldGraphPath(targetPath.replace(/^\//, '')))
    return move === undefined ? null : move.to
  }
  const reference = wikiNoteReference(targetPath)
  if (reference === null || reference.kind === 'self') {
    return null
  }
  if (reference.kind === 'path' || reference.kind === 'pathOrKey') {
    const move = map.byPath.get(foldGraphPath(reference.path))
    if (move !== undefined) {
      return move.kind === 'daily'
        ? move.to.slice(move.to.lastIndexOf('/') + 1, -'.md'.length)
        : move.to.slice(0, -'.md'.length)
    }
    if (reference.kind === 'path') {
      return null
    }
  }
  return map.dailyByName.get(reference.key) ?? null
}

function wikiSplice(source: string, from: number, to: number, map: ImportLinkMap): Splice | null {
  const inner = WIKI_SPAN_RE.exec(source.slice(from, to))?.[1]
  if (inner === undefined) {
    return null
  }
  const pipe = inner.indexOf('|')
  const target = pipe === -1 ? inner : inner.slice(0, pipe)
  const display = pipe === -1 ? '' : inner.slice(pipe)
  const hash = target.indexOf('#')
  const path = (hash === -1 ? target : target.slice(0, hash)).trim()
  const fragment = hash === -1 ? '' : target.slice(hash)
  if (path === '') {
    return null
  }
  const next = nextWikiTarget(path, map)
  return next === null ? null : { from, to, text: `[[${next}${fragment}${display}]]` }
}

/** Percent-encode a path for a Markdown href, keeping its slashes. */
function hrefFor(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function markdownSplice(
  notePath: string,
  source: string,
  from: number,
  to: number,
  map: ImportLinkMap,
): Splice | null {
  const match = MARKDOWN_LINK_RE.exec(source.slice(from, to))
  if (match === null) {
    return null
  }
  const [, prefix = '', rawHref = '', suffix = ''] = match
  const bracketed = rawHref.startsWith('<')
  const href = bracketed ? rawHref.slice(1, -1) : rawHref
  const move = attachmentReferenceCandidates(notePath, href)
    .map((candidate) => map.byPath.get(foldGraphPath(candidate)))
    .find((found) => found !== undefined)
  if (move === undefined) {
    return null
  }
  const next = bracketed ? `<${move.to}>` : hrefFor(move.to)
  return { from, to, text: `${prefix}${next}${suffix}` }
}

/**
 * Rewrite one note's links for the import's moves: wiki links and embeds in
 * the body and in frontmatter, and Markdown links and images to moved
 * attachments (written vault-root relative, as Kore writes `assets/…`).
 * Display text, `#fragments` and everything else stay byte-for-byte. Links
 * inside code are not links and are never touched. Pure.
 */
export function rewriteImportLinks(
  notePath: string,
  source: string,
  map: ImportLinkMap,
): ImportLinkRewrite {
  const parsed = parseNote({ path: notePath, source })
  const splices: Splice[] = []
  const seen = new Set<number>()
  const consider = (splice: Splice | null, from: number): void => {
    if (!seen.has(from)) {
      seen.add(from)
      if (splice !== null) {
        splices.push(splice)
      }
    }
  }
  for (const link of parsed.wikiLinks) {
    consider(wikiSplice(source, link.from, link.to, map), link.from)
  }
  for (const asset of parsed.assets) {
    if (seen.has(asset.from)) {
      continue
    }
    const text = source.slice(asset.from, asset.to)
    consider(
      text.startsWith('[[')
        ? wikiSplice(source, asset.from, asset.to, map)
        : markdownSplice(notePath, source, asset.from, asset.to, map),
      asset.from,
    )
  }
  return { source: applySplices(source, splices), links: splices.length }
}
