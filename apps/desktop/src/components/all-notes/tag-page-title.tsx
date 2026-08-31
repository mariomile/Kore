import type { ReactElement } from 'react'
import { Settings } from '@/components/icons'

interface TagPageTitleProps {
  /** The routed tag (display casing), the page's identity. */
  tag: string
  /** Typed tags carry the schema gear; untyped ones get the header CTA instead. */
  typed: boolean
  onBack: () => void
  onConfigure: () => void
}

/**
 * The tag page's identity block: an All notes breadcrumb back to the
 * unfiltered view, the tag as the path's current segment, and — once the tag
 * is typed — the schema gear, always visible rather than hover-revealed
 * (TDR 0005).
 *
 * The whole line is one quiet breadcrumb, not a headline: the tag names where
 * you are inside All Notes, and a display-sized `#tag` over its own table
 * shouted the same thing the rows already say.
 */
export function TagPageTitle({ tag, typed, onBack, onConfigure }: TagPageTitleProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-text-muted transition-colors hover:text-text"
      >
        All notes
      </button>
      <span aria-hidden className="text-sm text-text-muted">
        /
      </span>
      <h1 className="min-w-0 truncate text-sm font-semibold text-text">#{tag}</h1>
      {typed ? (
        <button
          type="button"
          aria-label={`Configure #${tag}`}
          title="Configure collection"
          onClick={onConfigure}
          className="app-icon-button text-text-muted hover:text-text"
        >
          <Settings aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
