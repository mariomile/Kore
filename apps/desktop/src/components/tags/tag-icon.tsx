import type { ReactElement } from 'react'
import { isTagSymbolIconName, parseNoteIcon } from '@reflect/core'
import { Hash } from '@/components/icons'
import { TagSymbolGlyph } from '@/components/tags/tag-symbol-glyph'
import { cn } from '@/lib/utils'

interface TagIconProps {
  /** The tag's stored icon (emoji or `icon:<name>`), or undefined for none. */
  icon: string | undefined
  /** Sizing for the symbol glyph (`size-3.5` and the like). */
  className?: string | undefined
  /** Text sizing for an emoji; defaults to the symbol's box. */
  emojiClassName?: string | undefined
}

/**
 * A tag's icon wherever the tag is named: the chosen emoji or app symbol,
 * else the `#` glyph every tag starts with, so the row reads as a tag even
 * before one is picked (the way a note row always carries its note glyph).
 */
export function TagIcon({ icon, className, emojiClassName }: TagIconProps): ReactElement {
  const parsed = icon === undefined ? null : parseNoteIcon(icon)
  if (parsed?.kind === 'emoji') {
    return (
      <span aria-hidden className={cn('shrink-0 leading-none', emojiClassName ?? className)}>
        {parsed.glyph}
      </span>
    )
  }
  const symbolProps = { 'aria-hidden': true, className: cn('shrink-0', className) }
  if (parsed?.kind === 'symbol' && isTagSymbolIconName(parsed.name)) {
    // A blank box of the glyph's size while the symbol table loads, so the
    // row does not flash a `#` it is about to replace.
    return (
      <TagSymbolGlyph
        name={parsed.name}
        {...symbolProps}
        fallback={<span aria-hidden className={cn('inline-block shrink-0', className)} />}
      />
    )
  }
  return <Hash {...symbolProps} />
}
