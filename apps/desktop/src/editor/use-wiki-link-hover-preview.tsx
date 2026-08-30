import { useCallback, useMemo, type ReactNode } from 'react'
import type { WikilinkHoverHit } from '@meowdown/core'
import { resolveExistingWikiTarget, splitFrontmatter, type DateFormat } from '@reflect/core'
import { WikiLinkHoverPreview } from '@/components/wiki-link-hover-preview'
import { passivePreviewImageResolver } from '@/editor/preview-image-url'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'

interface WikiLinkHoverPreviewOptions {
  generation: number | null
  graphKey: string | null
  dateFormat: DateFormat
  resolveImageUrl: (src: string) => string | null
  resolveAssetOpenPath: (src: string) => string | null
}

/**
 * Build the async body resolver for Meowdown's editor-scoped wiki-link hover
 * card. The whole preview is decided inside the returned promise: an existing
 * target resolves to a passive snapshot body; missing, ambiguous, unavailable,
 * and failed targets resolve to `null`, which renders no card. Failures are
 * swallowed into `null` rather than rejected: transient read errors (an iCloud
 * eviction, a graph switch) are expected and should not log as errors.
 */
export function useWikiLinkHoverPreview({
  generation,
  graphKey,
  dateFormat,
  resolveImageUrl,
  resolveAssetOpenPath,
}: WikiLinkHoverPreviewOptions): (hit: WikilinkHoverHit) => Promise<ReactNode> {
  // The passive no-network boundary, shared with the note-grid cards — see
  // editor/preview-image-url.ts for why SVG is skipped and assets are
  // raster-marked.
  const resolvePreviewImageUrl = useMemo(
    () => passivePreviewImageResolver({ resolveImageUrl, resolveAssetOpenPath }),
    [resolveAssetOpenPath, resolveImageUrl],
  )

  return useCallback(
    async ({ target }: WikilinkHoverHit): Promise<ReactNode> => {
      if (generation === null || graphKey === null) {
        return null
      }
      try {
        const resolution = await resolveExistingWikiTarget(target, generation)
        if (resolution.kind !== 'resolved') {
          return null
        }
        const source = await readExistingNoteSource(resolution.path, generation)
        return (
          <WikiLinkHoverPreview
            path={resolution.path}
            markdown={splitFrontmatter(source).body}
            dateFormat={dateFormat}
            resolveImageUrl={resolvePreviewImageUrl}
          />
        )
      } catch {
        return null
      }
    },
    [dateFormat, generation, graphKey, resolvePreviewImageUrl],
  )
}
