import { isAttachmentPath } from '../graph/paths'

function isAssetHref(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) {
    return false // external scheme, protocol-relative, or in-page anchor
  }
  return /(?:^|\/)assets\//.test(href)
}

/**
 * Every graph-relative path an authored attachment reference can mean, in
 * resolution order.
 *
 * `assets/x.png` is genuinely two things: Reflect has always written it
 * vault-root relative, while CommonMark and Obsidian read it as
 * source-relative. Both spellings are kept so neither an old Reflect note nor
 * an imported vault loses its images. The index stores both, which is inert
 * because only a path that exists on disk is ever consulted.
 *
 * An explicit `/x`, `./x`, or `../x` has one meaning and gets one candidate.
 */
export function attachmentReferenceCandidates(sourcePath: string, reference: string): string[] {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//')) {
    return []
  }
  const authored = decodeReferencePath(reference)
  if (authored === '') {
    return []
  }
  if (authored.startsWith('/')) {
    return keepAttachments([resolveSegments([], authored.slice(1))])
  }
  if (authored.startsWith('./') || authored.startsWith('../')) {
    return keepAttachments([resolveSegments(parentSegments(sourcePath), authored)])
  }
  return keepAttachments([
    resolveSegments(parentSegments(sourcePath), authored),
    resolveSegments([], authored),
  ])
}

/** Strip the fragment and query, then percent-decode. */
function decodeReferencePath(reference: string): string {
  const beforeQuery = (reference.split('#')[0] ?? '').split('?')[0] ?? ''
  try {
    return decodeURIComponent(beforeQuery)
  } catch {
    return beforeQuery // a malformed escape keeps the raw spelling, as before
  }
}

function parentSegments(sourcePath: string): readonly string[] {
  const segments = sourcePath.split('/')
  segments.pop()
  return segments
}

function resolveSegments(base: readonly string[], authored: string): string | null {
  if (authored.includes('\\') || authored.includes('\0')) {
    return null
  }
  const segments = [...base]
  for (const segment of authored.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (segments.pop() === undefined) {
        return null
      }
      continue
    }
    if (segment.startsWith('.')) {
      return null
    }
    segments.push(segment)
  }
  return segments.length === 0 ? null : segments.join('/')
}

function keepAttachments(candidates: readonly (string | null)[]): string[] {
  return [
    ...new Set(
      candidates.filter((path): path is string => path !== null && isAttachmentPath(path)),
    ),
  ]
}

/** Does this wiki-embed target name a supported attachment rather than a note? */
export function isAttachmentEmbedTarget(target: string): boolean {
  return target !== '' && isAttachmentPath(target.split('/').at(-1) ?? target)
}

/**
 * Wiki embeds are vault-root relative and never URL-decoded (Obsidian's
 * rules). A bare filename stays bare: which folder it lives in is a question
 * only a live catalog can answer, and the privacy gate matches such a
 * reference by basename. A target that resolves to no safe attachment path
 * (traversal, hidden components) returns null — it must never reach the
 * asset projection.
 */
export function wikiEmbedAssetPath(target: string): string | null {
  const path = resolveSegments([], target.replace(/^\//, ''))
  return path !== null && isAttachmentPath(path) ? path : null
}

/**
 * Canonicalize an asset href to the on-disk path. A note body may write the same
 * file many ways — percent-encoded (`assets/my%20photo.png`), `./`-prefixed
 * (`./assets/a.png`), with `..`/empty segments — while the file on disk (and the
 * watcher / `dir_list` / `readAsset` paths) is the collapsed `assets/...` form.
 * The index projection and the asset-description privacy gate key off this
 * canonical form, so every spelling of one file collapses to one key — a private
 * referer can't hide behind an alternate encoding *or* an alternate path shape.
 *
 * Decodes percent-escapes (a malformed escape keeps the raw href), then resolves
 * `.`/`..`/empty segments. The `AssetRef` span still points at the raw body text;
 * only the logical `path` is canonicalized.
 */
function decodeAssetPath(href: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(href)
  } catch {
    decoded = href
  }
  const segments: string[] = []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/**
 * The canonical on-disk path for an asset href, or `null` when the href is
 * not an asset link at all. The public entry point for callers holding an
 * href copied from raw markdown — e.g. the chat read_assets tool, whose
 * model-supplied paths are the verbatim link targets from note bodies —
 * applying the same {@link decodeAssetPath} rule the index projection uses,
 * so every spelling resolves to the indexed key.
 */
export function canonicalAssetPath(href: string): string | null {
  return isAssetHref(href) ? decodeAssetPath(href) : null
}
