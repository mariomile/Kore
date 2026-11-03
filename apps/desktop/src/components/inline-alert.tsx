import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Visual severity of an {@link InlineAlert}. */
export type InlineAlertTone = 'warning' | 'error'

const TONE_CLASSES: Record<InlineAlertTone, string> = {
  warning: 'border-warning/30 bg-warning-soft text-warning',
  error: 'border-danger/30 bg-danger-soft text-danger',
}

interface InlineAlertProps {
  tone?: InlineAlertTone
  children: ReactNode
  className?: string | undefined
}

/**
 * The in-flow alert banner used across the app (save failures, conflicts, the
 * read-only notice): one place for the tone palette and the `role="alert"`
 * semantics, so every surface announces consistently to assistive tech.
 */
export function InlineAlert({
  tone = 'warning',
  children,
  className,
}: InlineAlertProps): ReactElement {
  return (
    <div
      role="alert"
      className={cn('rounded-md border px-3 py-2 text-xs', TONE_CLASSES[tone], className)}
    >
      {children}
    </div>
  )
}
