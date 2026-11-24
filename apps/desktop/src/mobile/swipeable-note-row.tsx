import type { ReactElement } from 'react'
import { FolderMove, Pin, PinOff, Trash } from '@/components/icons'
import type { HighlightSegment } from '@kore/core'
import { formatRecencyLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { HighlightedText } from '@/mobile/highlighted-text'
import { useNoteRowSwipe } from '@/mobile/use-note-row-swipe'
import { useSettings } from '@/providers/settings-provider'

/** V1's row height (px) for a title over its preview line — also the
 * virtualizer's size estimate, since most rows carry a preview. */
export const NOTE_ROW_HEIGHT = 64

/** A row with nothing under its title (no preview, no properties): one
 * line, so it shrinks to the touch-target minimum instead of centering the
 * title in an empty second line's worth of space. */
export const COMPACT_NOTE_ROW_HEIGHT = 44

const ACTION_BUTTON_WIDTH = 68

/** One rendered row with query-aware title and snippet segments. */
export interface NoteRowModel {
  path: string
  /** Title split into plain and highlighted free-text search matches. */
  titleSegments: HighlightSegment[]
  /** File modification time (epoch ms) — the relative timestamp. */
  mtime: number
  isPinned: boolean
  /** Daily notes are part of the chronological spine: they can't be moved or deleted. */
  canDelete: boolean
  /** First content line; search hits carry highlighted match segments. */
  snippet: HighlightSegment[]
  /** Compact `Name: value` summary on typed-tag routes — replaces the
   * snippet line when set (the properties out-inform the first prose line
   * there). Never '': the producer only sets lines with content. */
  propertyLine?: string
}

interface SwipeableNoteRowProps {
  row: NoteRowModel
  revealed: boolean
  onReveal: () => void
  onClose: () => void
  onBeginInteraction: () => void
  onOpen: () => void
  onTogglePin: () => void
  /** Open the Move to… sheet for this note. */
  onMove: () => void
  onDelete: () => void
}

/**
 * One note row over its iOS-style reveal actions. The gesture physics live in
 * {@link useNoteRowSwipe}; this component owns the note-specific content and
 * accessible action controls.
 */
export function SwipeableNoteRow({
  row,
  revealed,
  onReveal,
  onClose,
  onBeginInteraction,
  onOpen,
  onTogglePin,
  onMove,
  onDelete,
}: SwipeableNoteRowProps): ReactElement {
  const { settings } = useSettings()
  const actionWidth = ACTION_BUTTON_WIDTH * (row.canDelete ? 3 : 1)
  const title = row.titleSegments.map((segment) => segment.text).join('')
  const height =
    row.propertyLine !== undefined || row.snippet.length > 0
      ? NOTE_ROW_HEIGHT
      : COMPACT_NOTE_ROW_HEIGHT
  const swipe = useNoteRowSwipe({
    actionWidth,
    revealed,
    onReveal,
    onClose,
    onBeginInteraction,
  })

  return (
    <div className="relative overflow-hidden" style={{ height }}>
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width: actionWidth }}
        aria-hidden={!revealed || undefined}
        inert={!revealed}
      >
        {row.canDelete ? (
          <SwipeAction
            revealed={revealed}
            tone="neutral"
            icon={<FolderMove />}
            label="Move"
            ariaLabel={`Move ${title}`}
            onPress={onMove}
          />
        ) : null}
        <SwipeAction
          revealed={revealed}
          tone="accent"
          icon={row.isPinned ? <PinOff /> : <Pin />}
          label={row.isPinned ? 'Unpin' : 'Pin'}
          ariaLabel={`${row.isPinned ? 'Unpin' : 'Pin'} ${title}`}
          onPress={() => {
            onClose()
            onTogglePin()
          }}
        />
        {row.canDelete ? (
          <SwipeAction
            revealed={revealed}
            tone="destructive"
            icon={<Trash />}
            label="Delete"
            ariaLabel={`Delete ${title}`}
            onPress={onDelete}
          />
        ) : null}
      </div>
      <button
        type="button"
        ref={swipe.ref}
        {...swipe.handlers}
        onClick={(event) => {
          if (swipe.consumeDragClick()) {
            event.preventDefault()
            return
          }
          if (revealed) {
            onClose()
            return
          }
          onOpen()
        }}
        className="absolute inset-0 flex w-full flex-col justify-center gap-0.5 overflow-hidden bg-background px-4 text-left"
        style={{ height }}
      >
        <span className="flex w-full items-baseline gap-2">
          {row.isPinned ? (
            <>
              <Pin aria-hidden className="size-3 shrink-0 self-center text-text-muted" />
              <span className="sr-only">Pinned</span>
            </>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            <HighlightedText segments={row.titleSegments} />
          </span>
          <span className="shrink-0 text-xs text-text-muted">
            {formatRecencyLabel(row.mtime, settings)}
          </span>
        </span>
        {row.propertyLine !== undefined ? (
          <span className="w-full truncate text-xs text-text-muted">{row.propertyLine}</span>
        ) : row.snippet.length > 0 ? (
          <span className="w-full truncate text-xs text-text-muted">
            <HighlightedText segments={row.snippet} />
          </span>
        ) : null}
      </button>
    </div>
  )
}

const TONE_CLASS = {
  neutral: 'bg-surface-active text-text',
  accent: 'bg-accent text-text-on-brand',
  destructive: 'bg-destructive text-text-on-brand',
} as const

interface SwipeActionProps {
  revealed: boolean
  tone: keyof typeof TONE_CLASS
  icon: ReactElement
  label: string
  ariaLabel: string
  onPress: () => void
}

/**
 * One action behind a swiped row: a round icon button over its label on the
 * page's own ground, the same circle as the rest of the phone's controls
 * (no full-height coloured slabs).
 */
function SwipeAction({
  revealed,
  tone,
  icon,
  label,
  ariaLabel,
  onPress,
}: SwipeActionProps): ReactElement {
  return (
    <button
      type="button"
      tabIndex={revealed ? 0 : -1}
      className="group flex h-full flex-col items-center justify-center gap-1"
      style={{ width: ACTION_BUTTON_WIDTH }}
      aria-label={ariaLabel}
      onClick={onPress}
    >
      <span
        className={cn(
          'flex size-10 items-center justify-center rounded-full transition-transform group-active:scale-90 motion-reduce:transition-none [&>svg]:size-[18px]',
          TONE_CLASS[tone],
        )}
      >
        {icon}
      </span>
      <span aria-hidden className="text-2xs font-medium text-text-muted">
        {label}
      </span>
    </button>
  )
}
