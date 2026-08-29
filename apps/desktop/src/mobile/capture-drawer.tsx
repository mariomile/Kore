import type { ReactElement } from 'react'
import { CheckCircle, Microphone, NoteEdit, NotePlus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { hapticImpactLight } from '@/mobile/haptics'

interface MobileCaptureDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDaily: () => void
  onNote: () => void
  onTask: () => void
  onRecord: () => void
  recordingAvailable: boolean
}

/**
 * The mobile capture hub for a daily-note line, a standalone note, a task, or
 * an audio memo.
 *
 * Daily leads because capture flows into the daily note by default
 * (AGENTS.md — "Daily notes first"); Note is the deliberate exception, the
 * one place on mobile that starts a standalone note. Task and Record already
 * land on today — the Tasks screen inserts into today's daily target, and a
 * memo files itself there — so those two need no separate destination.
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
  const choose = (action: () => void): void => {
    hapticImpactLight()
    onOpenChange(false)
    action()
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label="New">
        <DrawerTitle className="sr-only">New</DrawerTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pt-2 pb-4">
          <CaptureChoice label="Daily" icon={<NoteEdit />} onPress={() => choose(onDaily)} />
          <CaptureChoice label="Note" icon={<NotePlus />} onPress={() => choose(onNote)} />
          <CaptureChoice label="Task" icon={<CheckCircle />} onPress={() => choose(onTask)} />
          <CaptureChoice
            label="Record"
            icon={<Microphone />}
            disabled={!recordingAvailable}
            onPress={() => choose(onRecord)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function CaptureChoice({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  label: string
  icon: ReactElement
  disabled?: boolean
  onPress: () => void
}): ReactElement {
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-24 flex-col gap-2 rounded-2xl text-base"
      disabled={disabled}
      onClick={onPress}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-background text-foreground [&>svg]:size-5">
        {icon}
      </span>
      {label}
    </Button>
  )
}
