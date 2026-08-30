import type { ReactElement } from 'react'
import { dateFromDailyPath, type DateFormat } from '@reflect/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useOverflowing } from '@/hooks/use-overflowing'
import { formatDayLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'

interface WikiLinkHoverPreviewProps {
  path: string
  /** The note body with frontmatter already stripped. */
  markdown: string
  dateFormat: DateFormat
  resolveImageUrl: (src: string) => string | null
}

/**
 * Reflect's passive body for Meowdown's wiki-link hover card. Meowdown owns
 * the card chrome, sizing, and lifecycle; this renders only the content, from
 * a snapshot read at hover time. The `reflect-hover-preview` class re-scales
 * the editor type ramp to the card's compact size (styles/index.css), and a
 * body taller than the card fades out at the bottom edge instead of clipping
 * mid-line.
 */
export function WikiLinkHoverPreview({
  path,
  markdown,
  dateFormat,
  resolveImageUrl,
}: WikiLinkHoverPreviewProps): ReactElement {
  const dailyDate = dateFromDailyPath(path)
  const empty = markdown.trim().length === 0
  const { setRoot, overflowing } = useOverflowing()

  return (
    <div
      ref={setRoot}
      className={cn(
        'reflect-hover-preview max-h-48 overflow-hidden px-3.5 py-3 text-xs text-popover-foreground',
        overflowing && 'reflect-hover-preview-overflowing',
      )}
      data-testid="wiki-link-hover-preview"
    >
      <div>
        {dailyDate !== null ? (
          <div className="reflect-daily-subject mb-1">{formatDayLabel(dailyDate, dateFormat)}</div>
        ) : null}
        {empty ? (
          <p className="text-text-muted italic">Empty note</p>
        ) : (
          <MarkdownPreview
            content={markdown}
            resolveImageUrl={resolveImageUrl}
            interactive={false}
            className="text-xs leading-relaxed"
          />
        )}
      </div>
    </div>
  )
}
