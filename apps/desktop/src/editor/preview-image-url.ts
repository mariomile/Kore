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

function previewRasterUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}reflect-preview=raster`
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
    return url === null ? null : previewRasterUrl(url)
  }
}
