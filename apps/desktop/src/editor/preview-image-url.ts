/**
 * The passive-preview image boundary, in one place: a read-only preview (the
 * wiki-link hover card, the note-grid cards) must never start a network
 * fetch. Remote URLs resolve to nothing, SVG is skipped before any request
 * (its bytes can reference external subresources), and every asset URL
 * carries the raster marker so the asset protocol enforces its sniffed
 * raster-MIME allowlist — renamed SVG bytes cannot bypass the boundary.
 * Both consumers pass the pair `useAssetPersistence` hands back; keeping the
 * rule here means the next tightening happens once.
 */

function isSvgAsset(path: string): boolean {
  return path.toLowerCase().endsWith('.svg')
}

/**
 * Append an asset-protocol query flag. A `data:` URL (the plain-browser dev
 * bridge's assets) has no protocol to read it and a query would corrupt its
 * payload, so it passes through untouched.
 */
function withAssetQueryFlag(url: string, flag: string): string {
  if (url.startsWith('data:')) {
    return url
  }
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${flag}`
}

interface PassivePreviewImageSource {
  /** Graph-asset URL resolution (remote URLs pass through, unsafe → null). */
  resolveImageUrl: (src: string) => string | null
  /** Graph-relative asset path for a source, or null for remote/unsafe ones. */
  resolveAssetOpenPath: (src: string) => string | null
}

/** Build the `(src) => url | null` resolver a passive preview hands to MarkdownPreview. */
export function passivePreviewImageResolver({
  resolveImageUrl,
  resolveAssetOpenPath,
}: PassivePreviewImageSource): (src: string) => string | null {
  return (source: string): string | null => {
    const assetPath = resolveAssetOpenPath(source)
    if (assetPath === null || isSvgAsset(assetPath)) {
      return null
    }
    const url = resolveImageUrl(assetPath)
    return url === null ? null : withAssetQueryFlag(url, 'kore-preview=raster')
  }
}

/**
 * A passive preview URL asking for the card-sized thumbnail (a small JPEG the
 * asset protocol makes once and caches) instead of the original photo.
 */
export function previewThumbnailUrl(url: string): string {
  return withAssetQueryFlag(url, 'kore-thumb')
}
