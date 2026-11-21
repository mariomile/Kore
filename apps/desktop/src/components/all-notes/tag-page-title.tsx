import type { ReactElement } from 'react'
import { tagDisplayName } from '@kore/core'
import { TagIcon } from '@/components/tags/tag-icon'

interface TagPageTitleProps {
  /** The routed tag (display casing), the page's identity. */
  tag: string
  /** The tag's icon (emoji or symbol), when its definition sets one. */
  icon?: string | undefined
}

/**
 * The tag page's identity: the tag icon and heading (same display size as
 * All notes' "Notes"). Configuration lives with the collection's toolbar
 * controls so the page title stays calm and uncluttered.
 */
export function TagPageTitle({ tag, icon }: TagPageTitleProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TagIcon icon={icon} className="size-6 text-text-muted" emojiClassName="text-2xl" />
      <h1 className="app-page-title min-w-0 truncate text-text">{tagDisplayName(tag)}</h1>
    </div>
  )
}
