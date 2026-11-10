import { useMemo, type ReactElement } from 'react'
import {
  isTagSymbolIconName,
  parseNoteAppearanceFromSource,
  symbolIconValue,
  type NoteIcon,
} from '@reflect/core'
import { Smile } from '@/components/icons'
import { TagSymbolGlyph } from '@/components/tags/tag-symbol-glyph'
import { cn } from '@/lib/utils'
import { NoteIconPicker } from './note-icon-picker'

interface NoteAppearanceProps {
  /** Exact frontmatter bytes (or the full note source). */
  source: string
  resolveImageUrl: (src: string) => string | null
  /** Aligns the icon with the editor column when there is no cover. */
  gutterClassName?: string | undefined
  /**
   * Makes the icon editable: the icon opens a picker, and a note without one
   * shows "Add icon" while the pointer is over the note (a `group/note`
   * ancestor) or the control has focus. Omitted, the header only renders.
   */
  onIconChange?: ((icon: string | null) => void) | undefined
}

/** The `icon:` spelling of a parsed icon, as the picker compares values. */
function storedIconValue(icon: NoteIcon | null): string | null {
  if (icon === null) {
    return null
  }
  if (icon.kind === 'emoji') {
    return icon.glyph
  }
  return icon.kind === 'symbol' ? symbolIconValue(icon.name) : icon.src
}

/**
 * Cover image and icon from reserved frontmatter keys. Absent or unresolvable
 * values render nothing — the keys stay in the file either way.
 */
export function NoteAppearance({
  source,
  resolveImageUrl,
  gutterClassName,
  onIconChange,
}: NoteAppearanceProps): ReactElement | null {
  const appearance = useMemo(() => parseNoteAppearanceFromSource(source), [source])
  const coverUrl = appearance.coverSrc !== null ? resolveImageUrl(appearance.coverSrc) : null
  const icon = appearance.icon
  const iconUrl = icon?.kind === 'image' ? resolveImageUrl(icon.src) : null

  // The placeholder holds the glyph's box while the symbol table loads, so
  // the title does not shift when the icon arrives.
  const symbolEl =
    icon?.kind === 'symbol' && isTagSymbolIconName(icon.name) ? (
      <TagSymbolGlyph
        name={icon.name}
        aria-hidden
        className="size-10 text-text-secondary"
        fallback={<div aria-hidden className="size-10" />}
      />
    ) : null
  const glyphEl =
    icon === null ? null : icon.kind === 'emoji' ? (
      <div data-testid="note-icon" className="text-4xl leading-none" aria-label="Note icon">
        {icon.glyph}
      </div>
    ) : icon.kind === 'symbol' ? (
      symbolEl === null ? null : (
        <div data-testid="note-icon" aria-label="Note icon">
          {symbolEl}
        </div>
      )
    ) : iconUrl !== null ? (
      <img
        data-testid="note-icon"
        src={iconUrl}
        alt=""
        className="size-16 rounded-xl object-cover"
      />
    ) : null

  const iconValue = storedIconValue(icon)
  const iconEl =
    glyphEl !== null && onIconChange !== undefined ? (
      <NoteIconPicker
        value={iconValue}
        onChange={onIconChange}
        label="Change icon"
        className="-m-1 block p-1"
      >
        {glyphEl}
      </NoteIconPicker>
    ) : (
      glyphEl
    )

  // Hidden, not absent, until the note is hovered: the row keeps its height
  // so the title never jumps under the pointer, and focus reveals it for
  // keyboard users. An open picker keeps it visible.
  const addRow =
    onIconChange !== undefined && glyphEl === null ? (
      <div
        className={cn(
          'flex h-7 items-center opacity-0 transition-opacity duration-100 group-hover/note:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100',
          gutterClassName,
        )}
      >
        <NoteIconPicker
          value={iconValue}
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
