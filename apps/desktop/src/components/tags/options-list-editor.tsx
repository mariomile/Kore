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
import { Check, GripVertical, Plus, Trash, Undo } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  hashedOptionColor,
  OPTION_COLOR_LABELS,
  OPTION_COLORS,
  optionColorBadgeClass,
  optionColorDotClass,
} from './select-colors'
import { keptOptions, removeOption, type OptionDraft } from './tag-config-drafts'
import { DragHaptics } from '@/components/drag-haptics'

interface OptionsListEditorProps {
  options: readonly OptionDraft[]
  onChange: (next: OptionDraft[]) => void
  /**
   * How many notes use each stored option, by its stored text. `undefined`
   * while loading: every stored option then counts as in use.
   */
  usage?: ReadonlyMap<string, number> | undefined
  /** Phone layout: 48pt rows and larger type. */
  touch?: boolean
}

/** Base UI's drawer leaves a swipe that starts on this element alone. */
const SWIPE_IGNORE = { 'data-base-ui-swipe-ignore': '' }

/** The "take the value off the notes" choice of a deleted option. */
const REMOVE_FROM_NOTES = 'remove'

function noteCount(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'}`
}

/**
 * A select/status field's options as a list, the way Notion and Capacities
 * edit them: drag a row by its handle to set the order (the order the
 * board's lanes and every picker follow), type over a name to rename it
 * (saving carries the notes along; typing another option's name merges the
 * two), tap the color dot to paint it from the palette, and the trash to
 * delete it. Deleting an option notes still use keeps its row, struck
 * through, to pick where those notes go and to undo. Each name renders as
 * the badge the table will show, so the list previews the result. Shared by
 * the Mac dialog and the iPhone field page.
 */
export function OptionsListEditor({
  options,
  onChange,
  usage,
  touch = false,
}: OptionsListEditorProps): ReactElement {
  const [pending, setPending] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const nextId = options.reduce((max, option) => Math.max(max, option.id), -1) + 1
  const kept = keptOptions(options)
  const named = (name: string): OptionDraft[] =>
    name === '' ? [] : kept.filter((option) => option.name.trim() === name)
  // Options sharing a name merge into one on save: the one that already had
  // the name survives (else the first), the others fold into it.
  const mergeTarget = (option: OptionDraft): OptionDraft | null => {
    const sharing = named(option.name.trim())
    const survivor = sharing.find((entry) => entry.original === entry.name.trim()) ?? sharing[0]
    return survivor === undefined || survivor.id === option.id ? null : survivor
  }
  const pendingTaken = named(pending.trim()).length > 0
  const uses = (option: OptionDraft): number | undefined =>
    option.original === null
      ? 0
      : usage === undefined
        ? undefined
        : (usage.get(option.original) ?? 0)

  const add = (): void => {
    const name = pending.trim()
    // A name already in the list stays in the input, marked, instead of
    // vanishing without a word.
    if (name === '' || named(name).length > 0) {
      return
    }
    setPending('')
    onChange([...options, { id: nextId, name, original: null, color: null, removal: null }])
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
        <DragHaptics />
        <SortableContext
          items={options.map((option) => option.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul aria-label="Options">
            {options.map((option) =>
              option.removal === null ? (
                <OptionRow
                  key={option.id}
                  option={option}
                  touch={touch}
                  mergesInto={mergeTarget(option)?.name.trim() ?? null}
                  onRename={(name) => patch(option.id, { name })}
                  onColor={(color) => patch(option.id, { color })}
                  onRemove={() => onChange(removeOption(options, option.id, uses(option) !== 0))}
                />
              ) : (
                <RemovedOptionRow
                  key={option.id}
                  option={option}
                  touch={touch}
                  uses={uses(option)}
                  targets={kept.filter((target) => target.name.trim() !== '')}
                  moveToId={option.removal.moveToId}
                  onMoveTo={(moveToId) => patch(option.id, { removal: { moveToId } })}
                  onRestore={() => patch(option.id, { removal: null })}
                />
              ),
            )}
          </ul>
        </SortableContext>
      </DndContext>
      <div className={cn('flex items-center gap-2 pl-2.5 pr-2', touch ? 'h-12' : 'h-9')}>
        <Plus aria-hidden className="size-4 shrink-0 text-text-muted" />
        <input
          value={pending}
          aria-label="Add option"
          aria-invalid={pendingTaken || undefined}
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
        {pendingTaken ? (
          <span className="shrink-0 text-2xs text-destructive">Already in the list</span>
        ) : null}
      </div>
    </div>
  )
}

function OptionRow({
  option,
  touch,
  mergesInto,
  onRename,
  onColor,
  onRemove,
}: {
  option: OptionDraft
  touch: boolean
  /** Another option already carries this name: the two merge on save. */
  mergesInto: string | null
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
  const renamed = option.original !== null && option.name.trim() !== option.original
  // Menu rows: 44pt touch targets on the phone, compact on the Mac.
  const menuRow = touch ? 'h-11 text-base' : 'h-7 text-sm'
  const hint =
    mergesInto !== null
      ? option.original === null
        ? 'Already in the list'
        : `merges into ${mergesInto}`
      : renamed
        ? `was ${option.original}`
        : null

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/option relative flex items-center gap-1 bg-surface',
        touch ? 'min-h-12 border-b border-border' : 'min-h-9 pr-1 hover:bg-surface-hover',
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
        )}
      >
        <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">
          {option.name || ' '}
        </span>
        <input
          value={option.name}
          aria-label={`Option name: ${label}`}
          size={1}
          className="col-start-1 row-start-1 w-full min-w-[1ch] bg-transparent outline-none"
          onChange={(event) => onRename(event.target.value)}
          onBlur={() => {
            // A stored option cannot be left nameless: that would drop it
            // without saying what happens to its notes. Deleting is the trash.
            if (option.name.trim() === '' && option.original !== null) {
              onRename(option.original)
            }
          }}
        />
      </span>
      {hint === null ? null : (
        <span
          className={cn(
            'ml-1 truncate text-2xs',
            mergesInto !== null && option.original === null
              ? 'text-destructive'
              : 'text-text-muted',
          )}
        >
          {hint}
        </span>
      )}
      <span className="flex-1" />
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          aria-label={`Color of ${label}`}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-active',
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
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Delete ${label}`}
        onClick={onRemove}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-active hover:text-destructive',
          touch ? 'size-11 active:text-destructive' : 'size-7',
        )}
      >
        <Trash aria-hidden className={touch ? 'size-4' : 'size-3.5'} />
      </button>
    </li>
  )
}

/**
 * A deleted option some notes still use: its name struck through, where
 * those notes go on save (another option, or the value comes off them), and
 * the way back. Nothing is written before Save.
 */
function RemovedOptionRow({
  option,
  touch,
  uses,
  targets,
  moveToId,
  onMoveTo,
  onRestore,
}: {
  option: OptionDraft
  touch: boolean
  /** Notes using the option, or undefined while the count loads. */
  uses: number | undefined
  /** The options its notes can move to. */
  targets: readonly OptionDraft[]
  moveToId: number | null
  onMoveTo: (moveToId: number | null) => void
  onRestore: () => void
}): ReactElement {
  const { setNodeRef, transform, transition } = useSortable({
    id: option.id,
    disabled: true,
  })
  const stored = option.original ?? option.name.trim()
  const shown = option.color ?? hashedOptionColor(stored)
  const target = targets.find((entry) => entry.id === moveToId)
  const value = target === undefined ? REMOVE_FROM_NOTES : String(target.id)
  const count = uses === undefined ? 'its notes' : noteCount(uses)
  const choices: [value: string, label: string][] = [
    [REMOVE_FROM_NOTES, `Remove from ${count}`],
    ...targets.map((entry): [string, string] => [
      String(entry.id),
      `Move ${count} to ${entry.name.trim()}`,
    ]),
  ]

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-wrap items-center gap-x-2 bg-surface',
        touch ? 'min-h-12 border-b border-border py-1.5 pl-11 pr-1' : 'min-h-9 py-1 pl-8 pr-1',
      )}
    >
      <span
        className={cn(
          'min-w-0 truncate rounded-sm px-1.5 py-0.5 font-medium line-through opacity-50',
          touch ? 'text-sm' : 'text-xs',
          optionColorBadgeClass(shown),
        )}
      >
        {stored}
      </span>
      <span className={cn('flex-1', touch && 'order-1')} />
      <Select
        value={value}
        items={Object.fromEntries(choices)}
        onValueChange={(next) => {
          if (typeof next === 'string') {
            onMoveTo(next === REMOVE_FROM_NOTES ? null : Number(next))
          }
        }}
      >
        <SelectTrigger
          size={touch ? 'default' : 'sm'}
          aria-label={`Notes using ${stored}`}
          className={cn(
            'min-w-0 text-text-secondary',
            touch
              ? 'order-3 mb-1 basis-full text-base data-[size=default]:h-11'
              : 'max-w-64 text-xs',
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="min-w-60">
          {choices.map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        aria-label={`Restore ${stored}`}
        onClick={onRestore}
        className={cn(
          'flex shrink-0 items-center justify-center gap-1 rounded-md text-text-secondary transition-colors hover:bg-surface-active hover:text-text',
          touch ? 'order-2 h-11 px-3 text-base' : 'h-7 px-2 text-xs',
        )}
      >
        <Undo aria-hidden className={touch ? 'size-4' : 'size-3.5'} />
        Undo
      </button>
    </li>
  )
}
