import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import { cn } from '@/lib/utils'
import {
  dragHasFiles,
  firstImageFile,
  NoteCoverPicker,
  type CoverUpload,
} from './note-cover-picker'

/** What an editable cover can do; the header builds it from its callbacks. */
export interface CoverEdit {
  onChange: (cover: string | null) => void
  upload: CoverUpload
  /** Saves the vertical position (`cover_y:`, 0 top to 100 bottom); omitted, no Reposition. */
  onPositionChange?: ((coverY: number) => void) | undefined
}

const COVER_ACTION_CLASS =
  'rounded-md bg-surface/90 px-2 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-sm transition-colors hover:bg-surface hover:text-text'

/** Arrow keys move the cover by this many percentage points. */
const KEY_STEP = 5

function clampPosition(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * How many pixels of the image `object-fit: cover` crops off vertically, or
 * 0 when the image is too wide to have any: then there is nothing to move.
 */
export function coverVerticalSlack(image: HTMLImageElement): number {
  const { naturalWidth, naturalHeight, clientWidth, clientHeight } = image
  if (naturalWidth === 0 || naturalHeight === 0 || clientWidth === 0 || clientHeight === 0) {
    return 0
  }
  const scale = Math.max(clientWidth / naturalWidth, clientHeight / naturalHeight)
  return Math.max(0, naturalHeight * scale - clientHeight)
}

/**
 * The position after dragging the image `deltaY` pixels: dragging down shows
 * more of the top, so the percentage falls. One full slack of travel spans
 * the whole 0 to 100 range, which keeps the image under the pointer.
 */
export function dragCoverPosition(start: number, deltaY: number, slack: number): number {
  if (slack <= 0) {
    return clampPosition(start)
  }
  return clampPosition(start - (deltaY / slack) * 100)
}

interface NoteCoverProps {
  url: string
  /** The saved vertical position, 0 top to 100 bottom. */
  position: number
  edit: CoverEdit | null
}

/**
 * The cover image, cropped to a band at `position`. Editable, it shows
 * Change, Reposition and Remove while hovered (or focused, or while its
 * picker is open), and replaces itself with an image dropped on it.
 * Reposition makes the image draggable (or arrow-key movable) until Save or
 * Cancel; only Save writes `cover_y:`.
 */
export function NoteCover({ url, position, edit }: NoteCoverProps): ReactElement {
  const [dragOver, setDragOver] = useState(false)
  const [draft, setDraft] = useState<number | null>(null)
  const [movable, setMovable] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ pointerId: number; startY: number; start: number; slack: number } | null>(
    null,
  )
  const repositioning = draft !== null
  const shown = draft ?? position

  // Entering reposition mode hands focus to the image, so the arrow keys,
  // Enter and Escape work at once.
  useEffect(() => {
    if (repositioning) {
      imageRef.current?.focus()
    }
  }, [repositioning])

  const save = (): void => {
    if (draft !== null && edit !== null && draft !== position) {
      edit.onPositionChange?.(draft)
    }
    setDraft(null)
  }

  const image = (
    <img
      ref={imageRef}
      data-testid="note-cover"
      src={url}
      alt=""
      draggable={false}
      onLoad={(event) => setMovable(coverVerticalSlack(event.currentTarget) > 0)}
      style={{ objectPosition: `50% ${shown}%` }}
      className={cn(
        'h-40 w-full object-cover select-none',
        repositioning && 'cursor-grab touch-none active:cursor-grabbing',
      )}
      {...(repositioning
        ? {
            tabIndex: 0,
            'aria-label': 'Cover position',
            onPointerDown: (event: PointerEvent<HTMLImageElement>) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                start: shown,
                slack: coverVerticalSlack(event.currentTarget),
              }
            },
            onPointerMove: (event: PointerEvent<HTMLImageElement>) => {
              const current = drag.current
              if (current?.pointerId !== event.pointerId) {
                return
              }
              setDraft(
                dragCoverPosition(current.start, event.clientY - current.startY, current.slack),
              )
            },
            onPointerUp: () => {
              drag.current = null
            },
            onPointerCancel: () => {
              drag.current = null
            },
            onKeyDown: (event: KeyboardEvent<HTMLImageElement>) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                setDraft(clampPosition(shown + (event.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP)))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                save()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(null)
              }
            },
          }
        : {})}
    />
  )
  if (edit === null) {
    return image
  }

  const onDrop = (event: DragEvent): void => {
    if (repositioning || !dragHasFiles(event)) {
      return
    }
    event.preventDefault()
    setDragOver(false)
    const file = firstImageFile(event.dataTransfer.files)
    if (file !== null) {
      void edit.upload(file).then((path) => {
        if (path !== null) {
          edit.onChange(path)
        }
      })
    }
  }

  return (
    <div
      className="group/cover relative"
      onDragOver={(event) => {
        if (!repositioning && dragHasFiles(event)) {
          event.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {image}
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 bg-surface-inverse/30 ring-2 ring-border-focus ring-inset" />
      ) : null}
      {repositioning ? (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-surface-inverse/60 px-2 py-1 text-xs text-text-on-inverse">
              Drag the image to reposition
            </span>
          </div>
          <div className="absolute right-3 bottom-3 flex gap-1">
            <button type="button" className={COVER_ACTION_CLASS} onClick={save}>
              Save position
            </button>
            <button type="button" className={COVER_ACTION_CLASS} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="absolute right-3 bottom-3 flex gap-1 opacity-0 transition-opacity duration-100 group-hover/cover:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100">
          <NoteCoverPicker
            onChange={edit.onChange}
            upload={edit.upload}
            label="Change cover"
            className={COVER_ACTION_CLASS}
          >
            Change
          </NoteCoverPicker>
          {movable && edit.onPositionChange !== undefined ? (
            <button
              type="button"
              aria-label="Reposition cover"
              className={COVER_ACTION_CLASS}
              onClick={() => setDraft(position)}
            >
              Reposition
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Remove cover"
            className={COVER_ACTION_CLASS}
            onClick={() => edit.onChange(null)}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
