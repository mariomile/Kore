import { useState, type ReactElement } from 'react'
import { cn } from '@/lib/utils'

interface NoteCardPictureProps {
  /** The cached card thumbnail's URL (hooks/use-note-card-images.ts). */
  src: string
  className?: string
}

/**
 * The picture a note card leads with, edge to edge, on the Mac and phone
 * grids alike. Its box has a fixed aspect ratio, so the card is as tall
 * before the thumbnail arrives as after and the grid never moves; the image
 * fades in over the placeholder tint instead of popping. A thumbnail that
 * fails to load (the file went away since the index named it) collapses its
 * box rather than leaving an empty tile.
 */
export function NoteCardPicture({ src, className }: NoteCardPictureProps): ReactElement {
  const [state, setState] = useState<{ src: string; status: 'loading' | 'loaded' | 'failed' }>({
    src,
    status: 'loading',
  })
  // A new thumbnail (the note's picture changed) starts over.
  const status = state.src === src ? state.status : 'loading'
  return (
    <div
      className={cn(
        'aspect-[16/10] w-full shrink-0 overflow-hidden bg-surface-hover',
        status === 'failed' && 'hidden',
        className,
      )}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        data-testid="note-card-picture"
        onLoad={() => setState({ src, status: 'loaded' })}
        onError={() => setState({ src, status: 'failed' })}
        className={cn(
          'size-full object-cover motion-safe:transition-opacity motion-safe:duration-200',
          status === 'loaded' ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}
