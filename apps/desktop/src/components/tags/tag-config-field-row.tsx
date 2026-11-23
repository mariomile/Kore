import type { ReactElement } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, GripVertical } from '@/components/icons'
import { cn } from '@/lib/utils'
import { PROPERTY_TYPE_ICONS } from './property-type-icons'
import { PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'

/** Base UI's drawer leaves a swipe that starts here alone (the drag handle). */
const SWIPE_IGNORE = { 'data-base-ui-swipe-ignore': '' }

/** One field on the type page: drag handle, glyph, name, type, chevron. */
export function TagConfigFieldRow({
  draft,
  invalid,
  onOpen,
}: {
  draft: PropertyDraft
  invalid: boolean
  onOpen: () => void
}): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: draft.rowId })
  const Glyph = PROPERTY_TYPE_ICONS[draft.type]
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex min-h-12 items-center border-b border-border bg-surface',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${draft.name.trim() || 'field'}`}
        className="flex h-12 w-11 shrink-0 touch-none items-center justify-center text-text-muted"
        {...SWIPE_IGNORE}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 pr-4 text-left active:bg-surface-hover"
      >
        <Glyph aria-hidden className="size-4 shrink-0 text-text-muted" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-base',
            draft.name.trim() === '' ? 'text-text-muted' : 'text-text',
          )}
        >
          {draft.name.trim() || 'Untitled field'}
        </span>
        {invalid ? (
          <span className="shrink-0 text-xs text-destructive">Needs a name</span>
        ) : (
          <span className="shrink-0 text-sm text-text-muted">
            {PROPERTY_TYPE_LABELS[draft.type]}
          </span>
        )}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
      </button>
    </li>
  )
}
