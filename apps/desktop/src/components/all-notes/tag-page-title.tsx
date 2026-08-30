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
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onBack}
        className="text-[15px] font-medium text-text-muted transition-colors hover:text-text"
      >
        All notes
      </button>
      <span aria-hidden className="text-[15px] text-text-muted">
        /
      </span>
      <h1 className="min-w-0 truncate text-[15px] font-semibold text-text">#{tag}</h1>
      {typed ? (
        <button
          type="button"
          aria-label={`Configure #${tag}`}
          title="Configure collection"
          onClick={onConfigure}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-secondary"
        >
          <Settings aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
