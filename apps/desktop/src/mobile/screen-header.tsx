import type { ReactElement, ReactNode, Ref } from 'react'
import { ChevronLeft } from '@/components/icons'
import { Button } from '@/components/ui/button'

interface MobileScreenHeaderProps {
  title: string
  /**
   * Screen-reader name while {@link title} is empty (a note keeps its bar
   * blank until its own title scrolls away).
   */
  accessibleTitle?: string
  /** Pop the screen (the router's back, with a today fallback on cold entry). */
  onBack: () => void
  /** Optional trailing control (an add button, …). */
  trailing?: ReactNode
  /** A row under the bar that floats with it (a collection's view controls). */
  children?: ReactNode
  /** The measuring ref from {@link useBarHeightVar} on the screen root. */
  ref?: Ref<HTMLElement>
}

/**
 * The pushed-screen header bar: back chevron, title, optional trailing
 * control — the same chrome as the note screen, shared by the settings
 * screens so every card in the stack navigates the same way. It floats over
 * the screen as a translucent glass bar (it owns the top safe-area inset);
 * the screen pads its scroller past `--mobile-header-height`, published by
 * the `ref` the screen passes from {@link useBarHeightVar}.
 */
export function MobileScreenHeader({
  title,
  accessibleTitle,
  onBack,
  trailing,
  children,
  ref,
}: MobileScreenHeaderProps): ReactElement {
  return (
    <header
      ref={ref}
      className="mobile-glass-bar absolute inset-x-0 top-0 z-30"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="grid h-11 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center px-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 justify-self-center rounded-full bg-surface-hover"
          aria-label="Back"
          onClick={onBack}
        >
          <ChevronLeft />
        </Button>
        <h1 className="min-w-0 truncate text-center text-base font-semibold">
          {title === '' && accessibleTitle !== undefined ? (
            <span className="sr-only">{accessibleTitle}</span>
          ) : (
            title
          )}
        </h1>
        <div className="flex size-11 items-center justify-center justify-self-center">
          {trailing}
        </div>
      </div>
      {children === undefined ? null : <div className="px-4 pb-2">{children}</div>}
    </header>
  )
}
