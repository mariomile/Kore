import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { OptionColor } from '@kore/core'
import { Check, GripVertical, Plus, Trash } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  hashedOptionColor,
  OPTION_COLOR_LABELS,
  OPTION_COLORS,
  optionColorBadgeClass,
  optionColorDotClass,
} from './select-colors'
import type { OptionDraft } from './tag-config-drafts'

interface OptionsListEditorProps {
  options: readonly OptionDraft[]
  onChange: (next: OptionDraft[]) => void
  /** Phone layout: 48pt rows and larger type. */
  touch?: boolean
}

/** Base UI's drawer leaves a swipe that starts on this element alone. */
const SWIPE_IGNORE = { 'data-base-ui-swipe-ignore': '' }

/**
 * A select/status field's options as a list, the way Notion and Capacities
 * edit them: drag a row by its handle to set the order (the order the
 * board's lanes and every picker follow), type over a name to rename it
 * (saving carries the notes along), and tap the color dot to paint it from
 * the palette or delete it. Each name renders as the badge the table will
 * show, so the list previews the result. Shared by the Mac dialog and the
 * iPhone field page.
 */
export function OptionsListEditor({
  options,
  onChange,
  touch = false,
}: OptionsListEditorProps): ReactElement {
  const [pending, setPending] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const nextId = options.reduce((max, option) => Math.max(max, option.id), -1) + 1
  const taken = (name: string, exceptId?: number): boolean =>
    options.some((option) => option.id !== exceptId && option.name.trim() === name)

  const add = (): void => {
    const name = pending.trim()
    setPending('')
    if (name === '' || taken(name)) {
      return
    }
    onChange([...options, { id: nextId, name, original: null, color: null }])
  }

  const patch = (id: number, next: Partial<OptionDraft>): void => {
    onChange(options.map((option) => (option.id === id ? { ...option, ...next } : option)))
  }

  const onAddKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-surface',
        touch && 'rounded-xl',
      )}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => {
          if (event.over === null || event.over.id === event.active.id) {
            return
          }
          const from = options.findIndex((option) => option.id === event.active.id)
          const to = options.findIndex((option) => option.id === event.over?.id)
          if (from >= 0 && to >= 0) {
            onChange(arrayMove([...options], from, to))
          }
        }}
      >
        <SortableContext
          items={options.map((option) => option.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul aria-label="Options">
            {options.map((option) => (
              <OptionRow
                key={option.id}
                option={option}
                touch={touch}
                duplicate={option.name.trim() !== '' && taken(option.name.trim(), option.id)}
                onRename={(name) => patch(option.id, { name })}
                onColor={(color) => patch(option.id, { color })}
                onRemove={() => onChange(options.filter((entry) => entry.id !== option.id))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className={cn('flex items-center gap-2 pl-2.5 pr-2', touch ? 'h-12' : 'h-9')}>
        <Plus aria-hidden className="size-4 shrink-0 text-text-muted" />
        <input
          value={pending}
          aria-label="Add option"
          placeholder="Add an option"
          enterKeyHint="done"
          className={cn(
            'min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-muted',
            touch ? 'text-base' : 'text-sm',
          )}
          onChange={(event) => setPending(event.target.value)}
          onKeyDown={onAddKeyDown}
          onBlur={add}
        />
      </div>
    </div>
  )
}

function OptionRow({
  option,
  touch,
  duplicate,
  onRename,
  onColor,
  onRemove,
}: {
  option: OptionDraft
  touch: boolean
  duplicate: boolean
  onRename: (name: string) => void
  onColor: (color: OptionColor | null) => void
  onRemove: () => void
}): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id })
  const [menuOpen, setMenuOpen] = useState(false)
  const shown = option.color ?? hashedOptionColor(option.name.trim())
  const label = option.name.trim() || 'option'
  // Menu rows: 44pt touch targets on the phone, compact on the Mac.
  const menuRow = touch ? 'h-11 text-base' : 'h-7 text-sm'

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/option relative flex items-center gap-1 bg-surface pr-1.5',
        touch ? 'min-h-12 border-b border-border' : 'min-h-9 hover:bg-surface-hover',
        isDragging && 'z-10 rounded-md shadow-md',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${label}`}
        className={cn(
          'flex shrink-0 cursor-grab touch-none items-center justify-center text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing',
          touch ? 'h-12 w-10' : 'h-9 w-7',
        )}
        {...SWIPE_IGNORE}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      {/* The name sizes to its text inside a badge; the grid's hidden twin
          carries the width, so the badge hugs what is typed. */}
      <span
        className={cn(
          'inline-grid max-w-full min-w-0 rounded-sm px-1.5 py-0.5 font-medium',
          touch ? 'text-sm' : 'text-xs',
          optionColorBadgeClass(shown),
          duplicate && 'ring-1 ring-destructive',
        )}
      >
        <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">
          {option.name || ' '}
        </span>
        <input
          value={option.name}
          aria-label={`Option name: ${label}`}
          aria-invalid={duplicate || undefined}
          size={1}
          className="col-start-1 row-start-1 w-full min-w-[1ch] bg-transparent outline-none"
          onChange={(event) => onRename(event.target.value)}
        />
      </span>
      {option.original !== null && option.name.trim() !== option.original ? (
        <span className="ml-1 truncate text-2xs text-text-muted">was {option.original}</span>
      ) : null}
      <span className="flex-1" />
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          aria-label={`Color and actions for ${label}`}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover',
            touch ? 'size-11' : 'size-7',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'block rounded-full',
              touch ? 'size-3.5' : 'size-3',
              optionColorDotClass(shown),
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={4}
          className={cn('gap-0 p-1', touch ? 'w-56' : 'w-48')}
        >
          <p className="px-2 pb-1 pt-1.5 text-2xs font-medium text-text-muted">Color</p>
          <ul role="listbox" aria-label={`Color for ${label}`}>
            {OPTION_COLORS.map((color) => {
              const selected = option.color === color
              return (
                <li key={color}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onColor(color)
                      setMenuOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 text-left text-text transition-colors hover:bg-surface-hover',
                      menuRow,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn('size-3 rounded-full', optionColorDotClass(color))}
                    />
                    <span className="flex-1">{OPTION_COLOR_LABELS[color]}</span>
                    {selected ? (
                      <Check aria-hidden className="size-3.5 text-text-secondary" />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          {option.color !== null ? (
            <button
              type="button"
              onClick={() => {
                onColor(null)
                setMenuOpen(false)
              }}
              className={cn(
                'mt-0.5 flex w-full items-center gap-2.5 rounded-md px-2 text-left text-text-secondary transition-colors hover:bg-surface-hover',
                menuRow,
              )}
            >
              <span
                aria-hidden
                className="size-3 rounded-full border border-dashed border-border-strong"
              />
              Automatic
            </button>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              onRemove()
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 text-left text-destructive transition-colors hover:bg-surface-hover',
              menuRow,
            )}
          >
            <Trash aria-hidden className="size-3.5" />
            Delete option
          </button>
        </PopoverContent>
      </Popover>
    </li>
  )
}
