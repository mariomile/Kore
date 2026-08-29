import type { ReactElement } from 'react'
import { Calendar, CheckCircle, NotePlus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { hapticImpactLight } from '@/mobile/haptics'

interface MobileCaptureDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDaily: () => void
  onNote: () => void
  onTask: () => void
}

/** The mobile creation hub: one predictable entry point for Kore's three capture targets. */
export function MobileCaptureDrawer({
  open,
  onOpenChange,
  onDaily,
  onNote,
  onTask,
}: MobileCaptureDrawerProps): ReactElement {
  const choose = (action: () => void): void => {
    hapticImpactLight()
    onOpenChange(false)
    action()
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label="Create">
        <DrawerTitle>Create</DrawerTitle>
        <div className="grid grid-cols-3 gap-2 px-4 pb-4">
          <CaptureChoice label="Today" icon={<Calendar />} onPress={() => choose(onDaily)} />
          <CaptureChoice label="Note" icon={<NotePlus />} onPress={() => choose(onNote)} />
          <CaptureChoice label="Task" icon={<CheckCircle />} onPress={() => choose(onTask)} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function CaptureChoice({
  label,
  icon,
  onPress,
}: {
  label: string
  icon: ReactElement
  onPress: () => void
}): ReactElement {
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-24 flex-col gap-2 rounded-2xl text-base"
      onClick={onPress}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-background text-foreground [&>svg]:size-5">
        {icon}
      </span>
      {label}
    </Button>
  )
}
