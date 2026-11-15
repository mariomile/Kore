import { useEffect, useRef, useState, type ReactElement } from 'react'
import { addDays, format } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  Copy,
  FolderMove,
  IndentDecrease,
  IndentIncrease,
  Layers,
  Replace,
  Sparkles,
  Trash,
} from '@/components/icons'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import type { BlockSelection } from '@/editor/block-selection-store'
import type { FormattingBlockKind } from '@/editor/formatting-toolbar-store'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'

const KINDS: ReadonlyArray<{ kind: FormattingBlockKind; label: string }> = [
  { kind: 'text', label: 'Text' },
  { kind: 'heading', label: 'Heading' },
  { kind: 'bullet', label: '• List' },
  { kind: 'task', label: '☐ To-do' },
  { kind: 'quote', label: '❝ Quote' },
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

  const act = (run: () => void): void => {
    hapticImpactLight()
    run()
  }

  return (
    <>
      <div
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
            className="mobile-nav-capsule flex h-9 items-center gap-2 pr-1.5 pl-3.5 text-[14px] font-medium tabular-nums transition-transform active:scale-95"
          >
            {state.count === 1 ? '1 block' : `${state.count} blocks`}
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-white [&>svg]:size-3.5">
              <Check aria-hidden strokeWidth={2.4} />
            </span>
          </button>
        </div>
        <div
          role="toolbar"
          aria-label="Block actions"
          className="mobile-nav-capsule flex w-full max-w-md items-stretch justify-between px-1 py-1"
        >
          <BarButton
            label="Turn into"
            icon={<Replace />}
            tint="#8b5cf6"
            onPress={() => setSheet('turn')}
          />
          <BarButton
            label="Date"
            icon={<CalendarClock />}
            tint="#ff9500"
            onPress={() => setSheet('date')}
          />
          <BarButton
            label="Move to"
            icon={<FolderMove />}
            tint="#0a84ff"
            disabled={!single}
            onPress={() => act(commands.moveToNote)}
          />
          <BarButton
            label="Zoom"
            icon={<Layers />}
            tint="#30b0c7"
            disabled={!single}
            onPress={() => act(commands.zoom)}
          />
          <BarButton
            label="Ask AI"
            icon={<Sparkles />}
            tint="#ff2d92"
            onPress={() => act(commands.askAi)}
          />
          <BarButton
            label="Delete"
            icon={<Trash />}
            tint="#ff3b30"
            tone="danger"
            onPress={() => act(commands.remove)}
          />
        </div>
      </div>

      <Drawer open={sheet === 'turn'} onOpenChange={(open) => setSheet(open ? 'turn' : null)}>
        <DrawerContent aria-label="Turn into">
          <DrawerTitle className="sr-only">Turn into</DrawerTitle>
          <div className="flex flex-wrap gap-2 px-4 pt-1">
            {KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                aria-pressed={state.kind === kind}
                onClick={() => {
                  act(() => commands.setKind(kind))
                  setSheet(null)
                }}
                className={cn(
                  'h-10 rounded-full px-4 text-[15px] font-medium transition-transform active:scale-95',
                  state.kind === kind ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-4">
            <SheetAction
              label="Indent"
              icon={<IndentIncrease />}
              disabled={!state.canIndent}
              onPress={() => act(commands.indent)}
            />
            <SheetAction
              label="Outdent"
              icon={<IndentDecrease />}
              disabled={!state.canOutdent}
              onPress={() => act(commands.outdent)}
            />
            <SheetAction
              label="Duplicate"
              icon={<Layers />}
              onPress={() => {
                act(commands.duplicate)
                setSheet(null)
              }}
            />
            <SheetAction
              label="Move up"
              icon={<ArrowUp />}
              disabled={!state.canMoveUp}
              onPress={() => act(commands.moveUp)}
            />
            <SheetAction
              label="Move down"
              icon={<ArrowDown />}
              disabled={!state.canMoveDown}
              onPress={() => act(commands.moveDown)}
            />
            <SheetAction
              label="Copy"
              icon={<Copy />}
              onPress={() => {
                hapticImpactLight()
                void commands.copy()
                setSheet(null)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={sheet === 'date'} onOpenChange={(open) => setSheet(open ? 'date' : null)}>
        <DrawerContent aria-label="Date">
          <DrawerTitle className="px-4 pt-1 text-[13px] font-medium text-text-muted">
            Becomes a to-do with this date, listed in Tasks
          </DrawerTitle>
          <div className="flex flex-col gap-1 px-2 pt-2 pb-4">
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
                <span className="flex size-8 items-center justify-center rounded-lg bg-[#ff9500]/15 text-[13px] font-semibold text-[#ff9500] tabular-nums">
                  {format(addDays(new Date(), days), 'd')}
                </span>
                <span className="flex-1 text-[17px]">{label}</span>
                <span className="text-[15px] text-text-muted">
                  {format(addDays(new Date(), days), 'EEE d MMM')}
                </span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function BarButton({
  label,
  icon,
  onPress,
  disabled = false,
  tone,
  tint,
}: {
  label: string
  icon: ReactElement
  onPress: () => void
  disabled?: boolean
  tone?: 'danger'
  /** The glyph's color: each verb keeps one, as Craft's bar does. */
  tint: string
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] font-medium transition-[transform,background-color] active:scale-90 active:bg-foreground/5 disabled:opacity-30',
        tone === 'danger' ? 'text-[#ff3b30]' : 'text-text/80',
      )}
    >
      <span className="flex h-6 items-center [&>svg]:size-[23px]" style={{ color: tint }}>
        {icon}
      </span>
      {label}
    </button>
  )
}

function SheetAction({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string
  icon: ReactElement
  onPress: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl bg-surface-hover text-[13px] font-medium transition-transform active:scale-95 disabled:opacity-30 [&>svg]:size-5"
    >
      {icon}
      {label}
    </button>
  )
}
