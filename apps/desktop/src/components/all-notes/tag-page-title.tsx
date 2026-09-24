import type { ReactElement } from 'react'
import { tagDisplayName } from '@reflect/core'
import { Settings } from '@/components/icons'
import { TagIcon } from '@/components/tags/tag-icon'

interface TagPageTitleProps {
  /** The routed tag (display casing), the page's identity. */
  tag: string
  /** The tag's icon (emoji or symbol), when its definition sets one. */
  icon?: string | undefined
  onConfigure: () => void
}

/**
 * The tag page's identity: the tag as the heading (same display size as
 * All notes' "Notes"), with the schema gear always visible rather than
 * hover-revealed (TDR 0005) — every tag is a collection, so every tag page
 * can configure one. Back to the unfiltered list is the sidebar's All notes,
 * not a breadcrumb here.
 */
export function TagPageTitle({ tag, icon, onConfigure }: TagPageTitleProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TagIcon icon={icon} className="size-6 text-text-muted" emojiClassName="text-2xl" />
      <h1 className="app-page-title min-w-0 truncate text-text">{tagDisplayName(tag)}</h1>
      <button
        type="button"
        aria-label={`Configure #${tag}`}
        title="Configure type"
        onClick={onConfigure}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <Settings aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
