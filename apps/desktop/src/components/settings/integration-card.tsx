import type { ReactElement, ReactNode } from 'react'
import { siApple } from 'simple-icons'
import type { ConnectorId } from '@kore/core'
import { cn } from '@/lib/utils'
import { settingsSectionDomId, settingsSectionTitle, type SettingsSectionId } from './sections'

/** The integrations a logo exists for: the connectors, plus Apple's frameworks. */
export type IntegrationLogoId = ConnectorId | 'apple'

/**
 * Each integration's mark: the brand's own app icon (Granola's from
 * granola.ai, Readwise's from its App Store app), drawn full bleed, or a
 * 24×24 path in currentColor on the sunken tile for a monochrome mark like
 * Apple's, the way the AI provider logos are drawn.
 */
const LOGOS: Record<IntegrationLogoId, { icon: string } | { path: string }> = {
  granola: { icon: new URL('./logos/granola.png', import.meta.url).href },
  readwise: { icon: new URL('./logos/readwise.png', import.meta.url).href },
  apple: { path: siApple.path },
}

/** The integration's mark, sized like the AI provider tiles. */
export function IntegrationLogo({
  id,
  size = 'md',
}: {
  id: IntegrationLogoId
  /** `md`: a card header (40px); `sm`: a list row (28px). */
  size?: 'sm' | 'md'
}): ReactElement {
  const logo = LOGOS[id]
  const small = size === 'sm'
  const tile = small ? 'size-7 rounded-[7px]' : 'size-10 rounded-[10px]'
  if ('icon' in logo) {
    return (
      <img
        src={logo.icon}
        alt=""
        aria-hidden
        draggable={false}
        className={cn('flex-none border border-border object-cover select-none', tile)}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex flex-none items-center justify-center border border-border bg-surface-sunken text-text',
        tile,
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className={small ? 'size-4' : 'size-5'}>
        <path d={logo.path} />
      </svg>
    </span>
  )
}

/** The small "Connected" mark in a card's header. */
export function ConnectedBadge({ label = 'Connected' }: { label?: string }): ReactElement {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-text-secondary">
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      {label}
    </span>
  )
}

interface IntegrationCardProps {
  id: SettingsSectionId & IntegrationLogoId
  description: string
  /** Trailing header content, such as the {@link ConnectedBadge}. */
  status?: ReactNode
  /** The card's rows under the header, separated by hairlines. */
  children?: ReactNode
}

/**
 * One integration on the Integrations page: its mark, name and what it brings
 * as the card's header, its settings as rows underneath. Unlike the other
 * settings cards it doesn't fold away: the header is the identity, not a
 * section title.
 */
export function IntegrationCard({
  id,
  description,
  status,
  children,
}: IntegrationCardProps): ReactElement {
  const title = settingsSectionTitle(id)
  return (
    <section id={settingsSectionDomId(id)} aria-label={title} className="mt-5 first:mt-0">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface shadow-sm">
        <header className="flex items-center gap-3.5 px-4 py-3.5">
          <IntegrationLogo id={id} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-text">{title}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{description}</p>
          </div>
          {status}
        </header>
        {children}
      </div>
    </section>
  )
}
