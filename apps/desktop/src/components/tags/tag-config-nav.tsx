import type { ReactElement, ReactNode } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from '@/components/icons'
import { cn } from '@/lib/utils'
import { PROPERTY_TYPE_ICONS } from './property-type-icons'
import type { PropertyDraft } from './tag-config-drafts'
import type { TagConfigDraft } from './use-tag-config-draft'

/**
 * The left pane of the Mac type settings: a row for the type itself and the
 * properties as a list sorted by dragging a row's handle (it shows on hover).
 */

export function NavButton({
  active = false,
  muted = false,
  disabled,
  onClick,
  children,
}: {
  active?: boolean
  muted?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={active || undefined}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors disabled:opacity-50',
        active ? 'bg-surface-active text-text' : 'hover:bg-surface-hover',
        muted ? 'text-text-muted hover:text-text-secondary' : !active && 'text-text-secondary',
      )}
    >
      {children}
    </button>
  )
}

/** The properties as a sortable list: drag a row by its handle to reorder. */
export function PropertyNavList({
  config,
  selectedRowId,
  onSelect,
}: {
  config: TagConfigDraft
  selectedRowId: number | null
  onSelect: (rowId: number) => void
}): ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        if (event.over !== null && event.over.id !== event.active.id) {
          config.moveDraftTo(Number(event.active.id), Number(event.over.id))
        }
      }}
    >
      <SortableContext
        items={config.drafts.map((draft) => draft.rowId)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-0.5">
          {config.drafts.map((draft) => (
            <PropertyNavRow
              key={draft.rowId}
              draft={draft}
              active={draft.rowId === selectedRowId}
              invalid={
                config.invalidNameRowIds.has(draft.rowId) ||
                config.invalidKeyRowIds.has(draft.rowId)
              }
              onSelect={() => onSelect(draft.rowId)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function PropertyNavRow({
  draft,
  active,
  invalid,
  onSelect,
}: {
  draft: PropertyDraft
  active: boolean
  invalid: boolean
  onSelect: () => void
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
  const label = draft.name.trim()
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/prop relative flex h-8 items-center rounded-md transition-colors',
        active ? 'bg-surface-active' : 'hover:bg-surface-hover',
        isDragging && 'z-10 bg-surface shadow-md',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${label || 'property'}`}
        className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-text-muted opacity-0 transition-opacity group-hover/prop:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-left text-sm"
      >
        <Glyph aria-hidden className="size-4 shrink-0 text-text-muted" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            label === '' ? 'text-text-muted' : active ? 'text-text' : 'text-text-secondary',
          )}
        >
          {label || 'Untitled'}
        </span>
        {invalid ? (
          <span
            aria-label="Needs attention"
            className="size-1.5 shrink-0 rounded-full bg-destructive"
          />
        ) : null}
      </button>
    </li>
  )
}
