import type { ReactElement } from 'react'
import { CheckCircle, Microphone, NotePlus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { hapticImpactLight } from '@/mobile/haptics'

interface MobileCaptureDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNote: () => void
  onTask: () => void
  onRecord: () => void
  recordingAvailable: boolean
}

/** The mobile capture hub for a note, task, or audio memo. */
export function MobileCaptureDrawer({
  open,
  onOpenChange,
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
        <div className="grid grid-cols-3 gap-2 px-4 pt-2 pb-4">
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
