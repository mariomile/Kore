import type { ReactElement } from 'react'
import { Spinner as SpinnerIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

interface SpinnerProps {
  /** Additional classes, typically a size utility (e.g. `size-4`). Defaults to `size-3`. */
  className?: string
}

/** A spinning loading indicator. Pair with a visible text label and set `aria-hidden` is applied automatically. */
export function Spinner({ className }: SpinnerProps): ReactElement {
  return <SpinnerIcon aria-hidden className={cn('size-3 animate-spin', className)} />
}
