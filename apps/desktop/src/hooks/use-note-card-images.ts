import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { firstImageAssets } from '@kore/core'
import { passivePreviewImageResolver, previewThumbnailUrl } from '@/editor/preview-image-url'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

const NO_IMAGES: ReadonlyMap<string, string> = new Map()

/**
 * The body resolver of a card that leads with its picture: the band already
 * shows the image, so the body loads none (hiding them with CSS alone would
 * still fetch and decode every original behind the thumbnail).
 */
export function noImageUrl(): null {
  return null
}

/** A vault image source as a URL a passive card may load: no network, no SVG. */
export function usePassiveImageResolver(): (src: string) => string | null {
  const { graph } = useGraph()
  const { resolveImageUrl, resolveAssetOpenPath } = useAssetPersistence(graph?.generation ?? null)
  return useMemo(
    () => passivePreviewImageResolver({ resolveImageUrl, resolveAssetOpenPath }),
    [resolveAssetOpenPath, resolveImageUrl],
  )
}

/**
 * Card picture URLs by note path, for the cards on screen: the index names
 * each note's first raster image (its cover when it has one), and the
 * passive-preview resolver turns it into an asset URL (no network, no SVG)
 * for the card-sized cached thumbnail, never the original photo. Index-scoped,
 * so an edit that adds or removes a photo refreshes the grid with every other
 * index query.
 */
export function useFirstImages(paths: readonly string[]): ReadonlyMap<string, string> {
  const { graph } = useGraph()
  const resolve = usePassiveImageResolver()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'card-images', paths],
    queryFn: () => firstImageAssets(paths),
    enabled: graph !== null && graph !== undefined && paths.length > 0,
    // A new set of paths (a filter, a sort, the next chunk) keeps the
    // pictures it already has while the new set loads: dropping them for a
    // render collapsed every band and the columns jumped.
    placeholderData: keepPreviousData,
  })
  return useMemo(() => {
    if (data === undefined) {
      return NO_IMAGES
    }
    const urls = new Map<string, string>()
    for (const [path, asset] of data) {
      const url = resolve(asset)
      if (url !== null) {
        urls.set(path, previewThumbnailUrl(url))
      }
    }
    return urls
  }, [data, resolve])
}
