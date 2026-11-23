import type { ReactElement, ReactNode } from 'react'

/** An iOS-style grouped list: a muted caption over a rounded card. */
export function TagSheetSection({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}): ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
      {footer === undefined ? null : <div className="px-1 text-xs text-text-muted">{footer}</div>}
    </section>
  )
}
