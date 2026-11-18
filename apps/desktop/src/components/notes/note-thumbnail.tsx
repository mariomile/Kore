import type { CSSProperties, ReactElement } from 'react'
import { cn } from '@/lib/utils'
import { useNoteSkeleton } from '@/hooks/use-note-skeleton'

interface NoteThumbnailProps {
  /** Graph-relative path of the note to draw. */
  path: string
  /**
   * `row` sits beside a title in a list; `stack` is the small sheet the chat's
   * context pill fans out, ringed in the pill's tone so overlaps read.
   */
  size: 'row' | 'stack'
  className?: string
}

/**
 * The note as a tiny page — the same paper and rows as the editor's sub-page
 * card (`.kore-page-skel` in index.css), drawn from the file: headings bold,
 * bullets, numerals, boxes, quote rules. A blank sheet while it loads or when
 * the note has nothing past its title.
 */
export function NoteThumbnail({ path, size, className }: NoteThumbnailProps): ReactElement {
  const rows = useNoteSkeleton(path)
  return (
    <span aria-hidden data-size={size} className={cn('kore-page-thumb', className)}>
      {rows.slice(0, size === 'stack' ? 3 : undefined).map((row, index) => (
        <span
          key={index}
          className="kore-page-skel"
          data-kind={row.kind}
          style={
            {
              '--depth': String(row.depth),
              '--width': String(row.width),
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}
