import { useMemo, type ReactElement } from 'react'
import { parseNoteAppearanceFromSource } from '@reflect/core'
import { cn } from '@/lib/utils'

interface NoteAppearanceProps {
  /** Exact frontmatter bytes (or the full note source). */
  source: string
  resolveImageUrl: (src: string) => string | null
  /** Aligns the icon with the editor column when there is no cover. */
  gutterClassName?: string | undefined
}

/**
 * Cover image and icon from reserved frontmatter keys. Absent or unresolvable
 * values render nothing — the keys stay in the file either way.
 */
export function NoteAppearance({
  source,
  resolveImageUrl,
  gutterClassName,
}: NoteAppearanceProps): ReactElement | null {
  const appearance = useMemo(() => parseNoteAppearanceFromSource(source), [source])
  const coverUrl = appearance.coverSrc !== null ? resolveImageUrl(appearance.coverSrc) : null
  const icon = appearance.icon
  const iconUrl = icon?.kind === 'image' ? resolveImageUrl(icon.src) : null

  const iconEl =
    icon === null ? null : icon.kind === 'emoji' ? (
      <div data-testid="note-icon" className="text-4xl leading-none" aria-label="Note icon">
        {icon.glyph}
      </div>
    ) : iconUrl !== null ? (
      <img
        data-testid="note-icon"
        src={iconUrl}
        alt=""
        className="size-16 rounded-xl object-cover"
      />
    ) : null

  if (coverUrl === null && iconEl === null) {
    return null
  }

  if (coverUrl !== null) {
    return (
      <div className={cn('relative', iconEl !== null ? 'mb-10' : 'mb-3')}>
        <img data-testid="note-cover" src={coverUrl} alt="" className="h-40 w-full object-cover" />
        {iconEl !== null ? (
          <div className={cn('absolute -bottom-6', gutterClassName)}>{iconEl}</div>
        ) : null}
      </div>
    )
  }

  return <div className={cn('mb-2', gutterClassName)}>{iconEl}</div>
}
