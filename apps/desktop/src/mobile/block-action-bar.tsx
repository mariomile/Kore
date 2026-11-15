import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { addDays, format } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CalendarClock,
  ChevronRight,
  Check,
  Circle,
  Copy,
  FolderMove,
  IndentDecrease,
  IndentIncrease,
  Layers,
  List,
  Note,
  Locate,
  Replace,
  Sparkles,
  Trash,
} from '@/components/icons'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer'
import type { BlockSelection } from '@/editor/block-selection-store'
import type { FormattingBlockKind } from '@/editor/formatting-toolbar-store'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'

/** The top row: what the block reads as. Page lifts it into a note of its own. */
const STYLES: ReadonlyArray<{ kind: FormattingBlockKind; label: string; className: string }> = [
  { kind: 'heading', label: 'Heading', className: 'font-bold' },
  { kind: 'text', label: 'Text', className: '' },
  { kind: 'quote', label: 'Quote', className: 'font-serif italic' },
]

type Sheet = 'turn' | 'date' | null

/**
 * The bar that takes the tab bar's place while blocks are selected (swipe a
 * block right). Its verbs are Kore's own rather than Craft's: turn the block
 * into another kind, give it a date (it becomes a task that shows up in
 * Tasks), move it to another note, zoom into it, ask the AI about it, delete.
 */
export function MobileBlockActionBar({ selection }: { selection: BlockSelection }): ReactElement {
  const { state, commands } = selection
  const [sheet, setSheet] = useState<Sheet>(null)
  const single = state.count === 1

  // A tick each time a block joins the selection, the way a list picks up
  // a row in iOS edit mode.
  const lastCount = useRef(0)
  useEffect(() => {
    if (state.count > lastCount.current) hapticImpactLight()
    lastCount.current = state.count
  }, [state.count])

  // Stands in for the tab bar, so it publishes the same height variable:
  // the sync pill and every scroller's bottom padding keep clearing it.
  const barRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (bar === null) return
    const root = document.documentElement
    const publish = (): void => {
      root.style.setProperty('--mobile-tab-bar-height', `${bar.offsetHeight}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--mobile-tab-bar-height')
    }
  }, [])

  const act = (run: () => void): void => {
    hapticImpactLight()
    run()
  }

  return (
    <>
      <div
        ref={barRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 animate-in duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] fade-in-0 slide-in-from-bottom-6 motion-reduce:animate-none"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
          paddingLeft: 'max(env(safe-area-inset-left), 0.75rem)',
          paddingRight: 'max(env(safe-area-inset-right), 0.75rem)',
        }}
      >
        <div className="flex w-full max-w-md items-center justify-end">
          <button
            type="button"
            onClick={() => act(commands.clear)}
            aria-label="Done selecting"
            className="mobile-nav-capsule flex h-11 items-center gap-2 pr-2 pl-4 text-[15px] font-medium tabular-nums transition-transform active:scale-95"
          >
            {state.count === 1 ? '1 block' : `${state.count} blocks`}
            <span className="flex size-7 items-center justify-center rounded-full bg-accent text-white [&>svg]:size-4">
              <Check aria-hidden strokeWidth={2.4} />
            </span>
          </button>
        </div>
        <div
          role="toolbar"
          aria-label="Block actions"
          className="mobile-nav-capsule flex w-full max-w-md items-stretch justify-between px-1 py-1"
        >
          <BarButton label="Turn into" icon={<Replace />} onPress={() => setSheet('turn')} />
          <BarButton label="Date" icon={<CalendarClock />} onPress={() => setSheet('date')} />
          <BarButton
            label="Move"
            icon={<FolderMove />}
            disabled={!single}
            onPress={() => act(commands.moveToNote)}
          />
          <BarButton
            label="Zoom"
            icon={<Locate />}
            disabled={!single}
            onPress={() => act(commands.zoom)}
          />
          <BarButton label="Ask AI" icon={<Sparkles />} onPress={() => act(commands.askAi)} />
          <BarButton
            label="Delete"
            icon={<Trash />}
            tone="danger"
            onPress={() => act(commands.remove)}
          />
        </div>
      </div>

      <Drawer open={sheet === 'turn'} onOpenChange={(open) => setSheet(open ? 'turn' : null)}>
        <DrawerContent aria-label="Turn into">
          <SheetHeader
            title="Turn into"
            caption={state.count === 1 ? '1 block' : `${state.count} blocks`}
          />
          <DrawerBody className="gap-2 px-4">
            <div
              role="group"
              aria-label="Block style"
              className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-hover p-1"
            >
              {STYLES.map(({ kind, label, className }) => (
                <Segment
                  key={kind}
                  label={label}
                  className={className}
                  pressed={state.kind === kind}
                  onPress={() => {
                    act(() => commands.setKind(kind))
                    setSheet(null)
                  }}
                />
              ))}
              <Segment
                label="Page"
                icon={<Note />}
                disabled={!single}
                onPress={() => {
                  act(commands.makePage)
                  setSheet(null)
                }}
              />
            </div>
            <div role="group" aria-label="List and position" className="grid grid-cols-6 gap-2">
              <IconTile
                label="To-do"
                icon={<Circle />}
                pressed={state.kind === 'task'}
                onPress={() => {
                  act(() => commands.setKind('task'))
                  setSheet(null)
                }}
              />
              <IconTile
                label="Bulleted list"
                icon={<List />}
                pressed={state.kind === 'bullet'}
                onPress={() => {
                  act(() => commands.setKind('bullet'))
                  setSheet(null)
                }}
              />
              <IconTile
                label="Move up"
                icon={<ArrowUp />}
                disabled={!state.canMoveUp}
                onPress={() => act(commands.moveUp)}
              />
              <IconTile
                label="Move down"
                icon={<ArrowDown />}
                disabled={!state.canMoveDown}
                onPress={() => act(commands.moveDown)}
              />
              <IconTile
                label="Outdent"
                icon={<IndentDecrease />}
                disabled={!state.canOutdent}
                onPress={() => act(commands.outdent)}
              />
              <IconTile
                label="Indent"
                icon={<IndentIncrease />}
                disabled={!state.canIndent}
                onPress={() => act(commands.indent)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <WideTile
                label="Duplicate"
                icon={<Layers />}
                onPress={() => {
                  act(commands.duplicate)
                  setSheet(null)
                }}
              />
              <WideTile
                label="Copy"
                icon={<Copy />}
                onPress={() => {
                  hapticImpactLight()
                  void commands.copy()
                  setSheet(null)
                }}
              />
            </div>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <Drawer open={sheet === 'date'} onOpenChange={(open) => setSheet(open ? 'date' : null)}>
        <DrawerContent aria-label="Date">
          <SheetHeader title="Date" caption="Becomes a to-do with this date, listed in Tasks" />
          <DrawerBody className="gap-1 px-2">
            {(
              [
                ['today', 'Today', 0],
                ['tomorrow', 'Tomorrow', 1],
                ['nextWeek', 'In a week', 7],
              ] as const
            ).map(([when, label, days]) => (
              <button
                key={when}
                type="button"
                onClick={() => {
                  act(() => commands.remind(when))
                  setSheet(null)
                }}
                className="flex h-13 items-center gap-3 rounded-xl px-3 text-left active:bg-surface-hover"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-surface-hover text-[13px] font-semibold tabular-nums">
                  {format(addDays(new Date(), days), 'd')}
                </span>
                <span className="flex-1 text-[17px]">{label}</span>
                <span className="text-[15px] text-text-muted">
                  {format(addDays(new Date(), days), 'EEE d MMM')}
                </span>
              </button>
            ))}
            {/* The system calendar: an invisible date input over the row, so a
                tap opens iOS's own picker and the pick lands on change. */}
            <label className="relative flex h-13 items-center gap-3 rounded-xl px-3 active:bg-surface-hover">
              <span className="flex size-8 items-center justify-center rounded-lg bg-surface-hover [&>svg]:size-[18px]">
                <Calendar aria-hidden />
              </span>
              <span className="flex-1 text-[17px]">Pick a date</span>
              <ChevronRight aria-hidden className="size-4 text-text-muted" />
              <input
                type="date"
                aria-label="Pick a date"
                className="absolute inset-0 opacity-0"
                onChange={(event) => {
                  const picked = event.currentTarget.valueAsDate
                  if (picked === null) return
                  // valueAsDate is UTC midnight; keep the calendar day picked.
                  const day = new Date(
                    picked.getUTCFullYear(),
                    picked.getUTCMonth(),
                    picked.getUTCDate(),
                  )
                  act(() => commands.remind(day))
                  setSheet(null)
                }}
              />
            </label>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  )
}

/** Same header every Kore sheet uses: the drawer title, with a one-line caption under it. */
function SheetHeader({ title, caption }: { title: string; caption: string }): ReactElement {
  return (
    <>
      <DrawerTitle>{title}</DrawerTitle>
      <DrawerDescription className="mt-1.5 px-8">{caption}</DrawerDescription>
    </>
  )
}

function BarButton({
  label,
  icon,
  onPress,
  disabled = false,
  tone,
}: {
  label: string
  icon: ReactElement
  onPress: () => void
  disabled?: boolean
  tone?: 'danger'
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] font-medium transition-[transform,background-color] active:scale-90 active:bg-foreground/5 disabled:opacity-30',
        tone === 'danger' ? 'text-destructive' : 'text-text',
      )}
    >
      <span className="flex h-6 items-center [&>svg]:size-[23px]">{icon}</span>
      {label}
    </button>
  )
}

/** One segment of the style row: the lit one is raised, as iOS segmented controls are. */
function Segment({
  label,
  icon,
  className,
  pressed = false,
  disabled = false,
  onPress,
}: {
  label: string
  icon?: ReactElement
  className?: string
  pressed?: boolean
  disabled?: boolean
  onPress: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl text-[15px] transition-[transform,background-color] active:scale-95 disabled:opacity-30 [&_svg]:size-[18px]',
        pressed ? 'bg-surface-app text-text shadow-sm' : 'text-text/80',
        className,
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

/** A square glyph tile; the label is for VoiceOver, the glyph says it. */
function IconTile({
  label,
  icon,
  pressed,
  disabled = false,
  onPress,
}: {
  label: string
  icon: ReactElement
  pressed?: boolean
  disabled?: boolean
  onPress: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'flex aspect-square min-h-11 items-center justify-center rounded-xl transition-transform active:scale-95 disabled:opacity-30 [&_svg]:size-[22px]',
        pressed === true ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-text',
      )}
    >
      {icon}
    </button>
  )
}

function WideTile({
  label,
  icon,
  onPress,
}: {
  label: string
  icon: ReactElement
  onPress: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex h-12 items-center justify-center gap-2 rounded-xl bg-surface-hover text-[15px] font-medium transition-transform active:scale-95 [&_svg]:size-5"
    >
      {icon}
      {label}
    </button>
  )
}
