import { useMemo, type ReactElement } from 'react'
import { noteIconValue, parseNoteAppearanceFromSource } from '@reflect/core'
import { Smile } from '@/components/icons'
import { cn } from '@/lib/utils'
import { NoteIconGlyph } from './note-icon-glyph'
import { NoteIconPicker } from './note-icon-picker'

interface NoteAppearanceProps {
  /** Exact frontmatter bytes (or the full note source). */
  source: string
  resolveImageUrl: (src: string) => string | null
  /** Aligns the icon with the editor column when there is no cover. */
  gutterClassName?: string | undefined
  /**
   * Draw the icon here, above the body. False when the note's `#` title
   * line draws it instead (`NoteTitleIcon`), left of the title text.
   */
  showIcon?: boolean
  /**
   * Makes the icon editable: the icon opens a picker, and a note without one
   * shows "Add icon" while the pointer is over the note (a `group/note`
   * ancestor) or the control has focus. Omitted, the header only renders.
   */
  onIconChange?: ((icon: string | null) => void) | undefined
}

/**
 * Cover image and icon from reserved frontmatter keys. Absent or unresolvable
 * values render nothing — the keys stay in the file either way.
 */
export function NoteAppearance({
  source,
  resolveImageUrl,
  gutterClassName,
  showIcon = true,
  onIconChange,
}: NoteAppearanceProps): ReactElement | null {
  const appearance = useMemo(() => parseNoteAppearanceFromSource(source), [source])
  const coverUrl = appearance.coverSrc !== null ? resolveImageUrl(appearance.coverSrc) : null
  const icon = appearance.icon

  let iconEl: ReactElement | null = null
  if (icon !== null && showIcon) {
    const glyph = <NoteIconGlyph icon={icon} resolveImageUrl={resolveImageUrl} size="block" />
    iconEl =
      onIconChange === undefined ? (
        glyph
      ) : (
        <NoteIconPicker
          value={noteIconValue(icon)}
          onChange={onIconChange}
          label="Change icon"
          className="-m-1 block p-1"
        >
          {glyph}
        </NoteIconPicker>
      )
  }

  // Hidden, not absent, until the note is hovered: the row keeps its height
  // so the title never jumps under the pointer, and focus reveals it for
  // keyboard users. An open picker keeps it visible.
  const addRow =
    onIconChange !== undefined && icon === null ? (
      <div
        className={cn(
          'flex h-7 items-center opacity-0 transition-opacity duration-100 group-hover/note:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100',
          gutterClassName,
        )}
      >
        <NoteIconPicker
          value={null}
          onChange={onIconChange}
          label="Add icon"
          className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-text-muted hover:text-text"
        >
          <Smile aria-hidden className="size-3.5" />
          Add icon
        </NoteIconPicker>
      </div>
    ) : null

  if (coverUrl === null && iconEl === null) {
    return addRow
  }

  if (coverUrl !== null) {
    return (
      <div className={cn('relative', iconEl !== null ? 'mb-10' : 'mb-3')}>
        <img data-testid="note-cover" src={coverUrl} alt="" className="h-40 w-full object-cover" />
        {iconEl !== null ? (
          <div className={cn('absolute -bottom-6', gutterClassName)}>{iconEl}</div>
        ) : null}
        {addRow}
      </div>
    )
  }

  return <div className={cn('mb-2', gutterClassName)}>{iconEl}</div>
}
