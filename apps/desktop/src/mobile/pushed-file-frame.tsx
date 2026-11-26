import type { ReactElement, ReactNode } from 'react'
import type { Route } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { MobileScreenHeader } from './screen-header'
import { useBarHeightVar } from './use-bar-height'

interface MobilePushedFileFrameProps {
  title: string
  /** Where back goes on a cold entry, with no screen under this one. */
  fallback: Route
  children: ReactNode
}

/**
 * The phone's frame for a vault file that opens as a screen of its own (a
 * canvas, a base): the stack's glass bar with its back chevron and the
 * file's name, the screen's body running under it.
 */
export function MobilePushedFileFrame({
  title,
  fallback,
  children,
}: MobilePushedFileFrameProps): ReactElement {
  const { navigate, back, canBack } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title={title}
        onBack={() => (canBack ? back() : navigate(fallback))}
      />
      <main
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
      >
        {children}
      </main>
    </div>
  )
}
