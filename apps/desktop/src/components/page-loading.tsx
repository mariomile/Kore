import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'

const KORE_MARK = new URL('./kore-mark.png', import.meta.url).href

interface PageLoadingProps {
  /** Accessible status label (defaults to "Loading"). */
  label?: string
  className?: string
}

/**
 * Centered, delayed loading state for in-app page transitions: stays invisible
 * for 180ms (`.kore-note-loading`) so fast local loads never flash anything,
 * then gently reveals the breathing Kore gem mark centered in the pane instead
 * of a bare top-left "Loading…" string.
 */
export function PageLoading({ label = 'Loading', className }: PageLoadingProps): ReactElement {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        'kore-note-loading flex min-h-48 flex-1 items-center justify-center',
        className,
      )}
    >
      <span aria-hidden className="kore-boot-mark">
        <img src={KORE_MARK} alt="" className="h-10 w-auto invert dark:invert-0" />
      </span>
    </div>
  )
}
