import type { ReactElement } from 'react'
import { Settings } from '@/components/icons'

interface TagPageTitleProps {
  /** The routed tag (display casing), the page's identity. */
  tag: string
  onConfigure: () => void
}

/**
 * The tag page's identity: the tag as the heading (same display size as
 * All notes' "Notes"), with the schema gear always visible rather than
 * hover-revealed (TDR 0005) — every tag is a collection, so every tag page
 * can configure one. Back to the unfiltered list is the sidebar's All notes,
 * not a breadcrumb here.
 */
export function TagPageTitle({ tag, onConfigure }: TagPageTitleProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h1 className="app-page-title min-w-0 truncate text-text">#{tag}</h1>
      <button
        type="button"
        aria-label={`Configure #${tag}`}
        title="Configure collection"
        onClick={onConfigure}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <Settings aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
