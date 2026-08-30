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
 * unfiltered view, the tag as the title, and — once the tag is typed — the
 * schema gear, always visible rather than hover-revealed (TDR 0005).
 */
export function TagPageTitle({ tag, typed, onBack, onConfigure }: TagPageTitleProps): ReactElement {
  return (
    // Craft register (Plan 28): the tag is the page's display-sized title;
    // the breadcrumb reads as small quiet chrome beside it.
    <div className="flex min-w-0 items-baseline gap-2">
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
      <h1 className="app-page-title min-w-0 truncate text-text">#{tag}</h1>
      {typed ? (
        <button
          type="button"
          aria-label={`Configure #${tag}`}
          title="Configure collection"
          onClick={onConfigure}
          className="flex size-6 shrink-0 translate-y-0.5 items-center justify-center self-center rounded-full text-text-muted transition-colors hover:text-text-secondary"
        >
          <Settings aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
