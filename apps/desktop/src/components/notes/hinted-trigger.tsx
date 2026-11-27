import type { ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface HintedTriggerProps {
  /** The tooltip text; omitted, the trigger renders bare. */
  hint?: string | undefined
  /** A popover trigger element, which the tooltip trigger renders as. */
  children: ReactElement
}

/**
 * Names an icon-only picker trigger on hover: the tooltip trigger renders as
 * the picker's own trigger, so one button opens the picker and shows the hint.
 */
export function HintedTrigger({ hint, children }: HintedTriggerProps): ReactElement {
  if (hint === undefined) {
    return children
  }
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  )
}
