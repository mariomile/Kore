import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  /** One quiet line under the title saying what the page lists. */
  description?: ReactNode
  /** Header chrome on the right: pills and round icon buttons. */
  children?: ReactNode
  className?: string
}

/**
 * The header every app page opens with: the page title at the left edge the
 * Notes table and the folder page share, the page's controls on the right.
 * One component so a new screen cannot invent its own title size or gutter.
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps): ReactElement {
  return (
    <header
      className={cn(
        'flex flex-none flex-wrap items-center justify-between gap-3 py-5 pr-7 pl-12',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="app-page-title truncate text-text">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 truncate text-[13px] text-text-muted">{description}</p>
        )}
      </div>
      {children === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      )}
    </header>
  )
}

/** The reading column under a {@link PageHeader}, on the same left edge. */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactElement {
  return <div className={cn('max-w-3xl pr-7 pb-10 pl-12', className)}>{children}</div>
}
