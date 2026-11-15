import { useEffect, useRef, useState, type ReactElement } from 'react'
import { captureInboxSpool, errorMessage } from '@kore/core'
import { ArrowRight, CheckCircle, Microphone, NoteEdit, NotePlus } from '@/components/icons'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import {
  TEXT_CAPTURE_MAX_LENGTH,
  buildGlobalShortcutEnvelope,
  foldQuickCaptureText,
} from '@/lib/quick-capture'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { requestCaptureDrain } from '@/providers/capture-provider'
import { useGraph } from '@/providers/graph-provider'

interface MobileCaptureDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDaily: () => void
  onNote: () => void
  onTask: () => void
  onRecord: () => void
  recordingAvailable: boolean
}

type Destination = 'daily' | 'task' | 'note'

/**
 * Quick capture (iPhone design pass, 2026-11, after Things'
 * Quick Entry): the + opens straight into a text field with the keyboard up.
 * Type, pick where it goes (today's daily by default, a task, or a new note),
 * send. Daily and task lines go through the same capture inbox the share
 * sheet and the Mac's global shortcut write, so they land on today's daily
 * even while the daily is not open. An empty field keeps the old shortcuts:
 * Daily / Note / Task open their screens, the mic records a memo.
 */
export function MobileCaptureDrawer({
  open,
  onOpenChange,
  onDaily,
  onNote,
  onTask,
  onRecord,
  recordingAvailable,
}: MobileCaptureDrawerProps): ReactElement {
  const { graph } = useGraph()
  const [text, setText] = useState('')
  const [destination, setDestination] = useState<Destination>('daily')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    // Focus inside the opening gesture's task so iOS raises the keyboard.
    const id = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(id)
  }, [open])

  const line = foldQuickCaptureText(text)

  const close = (): void => {
    setError(null)
    onOpenChange(false)
  }

  function openScreen(target: Destination): void {
    close()
    if (target === 'daily') onDaily()
    else if (target === 'task') onTask()
    else onNote()
  }

  // With nothing typed, a destination is a shortcut to its screen (the old
  // hub's behaviour); once there is text, it picks where the line goes.
  function choose(target: Destination): void {
    if (line === '') openScreen(target)
    else setDestination(target)
  }

  async function send(): Promise<void> {
    if (line === '') {
      openScreen(destination)
      return
    }
    if (destination === 'note') {
      close()
      onNote()
      return
    }
    if (graph === null) return
    try {
      const envelope = buildGlobalShortcutEnvelope(line, destination === 'task' ? 'task' : 'append')
      await captureInboxSpool(`${envelope.id}.json`, JSON.stringify(envelope), graph.generation)
      requestCaptureDrain()
      hapticImpactLight()
      setText('')
      close()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DrawerContent aria-label="New">
        <DrawerTitle className="sr-only">New</DrawerTitle>
        <form
          className="px-4 pt-1 pb-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <textarea
            ref={inputRef}
            value={text}
            maxLength={TEXT_CAPTURE_MAX_LENGTH}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={
              destination === 'task'
                ? 'New task for today'
                : destination === 'note'
                  ? 'New note'
                  : 'Add to today’s daily'
            }
            aria-label="Capture"
            className="w-full resize-none bg-transparent text-[17px] leading-snug outline-none placeholder:text-text-muted"
          />
          {error !== null ? <p className="pb-2 text-[13px] text-destructive">{error}</p> : null}
          <div className="flex items-center gap-1.5">
            <DestinationChip
              label="Daily"
              icon={<NoteEdit />}
              active={destination === 'daily'}
              onPress={() => choose('daily')}
            />
            <DestinationChip
              label="Task"
              icon={<CheckCircle />}
              active={destination === 'task'}
              onPress={() => choose('task')}
            />
            <DestinationChip
              label="Note"
              icon={<NotePlus />}
              active={destination === 'note'}
              onPress={() => choose('note')}
            />
            <button
              type="button"
              aria-label="Record"
              disabled={!recordingAvailable}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                hapticImpactLight()
                close()
                onRecord()
              }}
              className="ml-auto flex size-10 items-center justify-center rounded-full bg-surface-hover transition-transform active:scale-90 disabled:opacity-40 [&>svg]:size-5"
            >
              <Microphone />
            </button>
            <button
              type="submit"
              aria-label="Add"
              onPointerDown={(event) => event.preventDefault()}
              className={cn(
                'flex size-10 items-center justify-center rounded-full transition-[transform,opacity] active:scale-90 [&>svg]:size-5',
                line === '' ? 'bg-foreground/15 text-foreground' : 'bg-foreground text-background',
              )}
            >
              <ArrowRight />
            </button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

function DestinationChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string
  icon: ReactElement
  active: boolean
  onPress: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        hapticImpactLight()
        onPress()
      }}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition-[transform,background-color] active:scale-95 [&>svg]:size-4',
        active ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-text',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
