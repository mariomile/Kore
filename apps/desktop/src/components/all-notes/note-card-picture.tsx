import { useState, type ReactElement, type SyntheticEvent } from 'react'
import {
  DEFAULT_PICTURE_RATIO,
  clampPictureRatio,
  rememberPictureRatio,
  rememberedPictureRatio,
} from '@/lib/card-picture-ratios'
import { cn } from '@/lib/utils'

interface NoteCardPictureProps {
  /** The cached card thumbnail's URL (hooks/use-note-card-images.ts). */
  src: string
  className?: string
}

interface PictureState {
  src: string
  status: 'loading' | 'loaded' | 'failed'
  /** The box's width-to-height ratio. */
  ratio: number
}

function initialState(src: string): PictureState {
  return { src, status: 'loading', ratio: rememberedPictureRatio(src) ?? DEFAULT_PICTURE_RATIO }
}

/**
 * Can a picture's box change shape without moving anything the reader sees?
 * Yes below the screen, where the grid has not reached yet, and while its
 * card still hides, waiting for its preview (card-preview-slot.tsx). Never
 * on or above the screen: the cards under it would jump.
 */
function canReshape(box: HTMLElement): boolean {
  return (
    box.getBoundingClientRect().top >= window.innerHeight ||
    box.closest('[data-note-path]')?.querySelector('[data-preview-pending]') != null
  )
}

/**
 * The picture a note card leads with, edge to edge, on the Mac and phone
 * grids alike, at the picture's own shape (within a portrait and a
 * panorama, lib/card-picture-ratios.ts). The box's shape is set before the
 * thumbnail arrives, so the grid never moves: the shape remembered from the
 * last time the picture showed, else a default that the picture's own
 * replaces once it loads, only where that moves nothing in sight. The image
 * fades in over the placeholder tint instead of popping. A thumbnail that
 * fails to load (the file went away since the index named it) collapses its
 * box rather than leaving an empty tile.
 */
export function NoteCardPicture({ src, className }: NoteCardPictureProps): ReactElement {
  const [state, setState] = useState<PictureState>(() => initialState(src))
  // A new thumbnail (the note's picture changed) starts over.
  const current = state.src === src ? state : initialState(src)
  const onLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const image = event.currentTarget
    const own =
      image.naturalHeight > 0 ? clampPictureRatio(image.naturalWidth / image.naturalHeight) : null
    if (own !== null) {
      rememberPictureRatio(src, own)
    }
    const box = image.parentElement
    const ratio =
      own !== null && own !== current.ratio && box !== null && canReshape(box) ? own : current.ratio
    setState({ src, status: 'loaded', ratio })
  }
  return (
    <div
      style={{ aspectRatio: current.ratio }}
      className={cn(
        'w-full shrink-0 overflow-hidden bg-surface-hover',
        current.status === 'failed' && 'hidden',
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
        onLoad={onLoad}
        onError={() => setState({ ...current, status: 'failed' })}
        className={cn(
          'size-full object-cover motion-safe:transition-opacity motion-safe:duration-200',
          current.status === 'loaded' ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}
