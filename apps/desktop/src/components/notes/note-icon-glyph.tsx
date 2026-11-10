import type { ReactElement } from 'react'
import { isTagSymbolIconName, type NoteIcon } from '@reflect/core'
import { TagSymbolGlyph } from '@/components/tags/tag-symbol-glyph'
import { cn } from '@/lib/utils'

interface NoteIconGlyphProps {
  icon: NoteIcon
  resolveImageUrl: (src: string) => string | null
  /**
   * `inline` sizes the glyph to the surrounding text (the title line);
   * `block` is the larger icon drawn on its own above a title-less note.
   */
  size: 'inline' | 'block'
}

const SIZES = {
  inline: { emoji: 'text-[1em]', symbol: 'size-[1em]', image: 'size-[1.2em] rounded-md' },
  block: { emoji: 'text-4xl', symbol: 'size-10', image: 'size-16 rounded-xl' },
} as const

/**
 * A note's icon: the emoji, the app symbol, or the image, at one of two
 * sizes. Null for a symbol the app does not know or an image that does not
 * resolve, so a broken value draws nothing rather than a placeholder.
 */
export function NoteIconGlyph({
  icon,
  resolveImageUrl,
  size,
}: NoteIconGlyphProps): ReactElement | null {
  const classes = SIZES[size]
  if (icon.kind === 'emoji') {
    return (
      <span
        data-testid="note-icon"
        aria-label="Note icon"
        className={cn('block leading-none', classes.emoji)}
      >
        {icon.glyph}
      </span>
    )
  }
  if (icon.kind === 'symbol') {
    if (!isTagSymbolIconName(icon.name)) {
      return null
    }
    // The placeholder holds the glyph's box while the symbol table loads, so
    // the title does not shift when the icon arrives.
    return (
      <span data-testid="note-icon" aria-label="Note icon" className="block">
        <TagSymbolGlyph
          name={icon.name}
          aria-hidden
          className={cn('text-text-secondary', classes.symbol)}
          fallback={<span aria-hidden className={cn('block', classes.symbol)} />}
        />
      </span>
    )
  }
  const url = resolveImageUrl(icon.src)
  return url === null ? null : (
    <img
      data-testid="note-icon"
      src={url}
      alt=""
      className={cn('block object-cover', classes.image)}
    />
  )
}
