import type { ReactNode } from 'react'
import type { HighlightSegment } from '@reflect/core'

/**
 * Render search-highlight segments as `<mark>` chips. Shared by the All-tab
 * row list and the card grid so a free-text match looks the same in both
 * layouts.
 */
export function HighlightedText({ segments }: { segments: HighlightSegment[] }): ReactNode {
  return segments.map((segment, index) =>
    segment.highlighted ? (
      <mark key={index} className="rounded-sm bg-primary/15 text-text">
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  )
}
