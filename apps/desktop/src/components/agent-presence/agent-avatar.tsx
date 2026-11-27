import type { ReactElement } from 'react'
import { PROVIDER_BRANDS } from '@/components/settings/provider-brands'
import { cn } from '@/lib/utils'

/** The brand mark for an agent's name ("Claude Code" → Claude), or null for the generic mark. */
export function agentBrandPath(agent: string): string | null {
  const name = agent.toLowerCase()
  const brand = PROVIDER_BRANDS.find(
    (entry) =>
      entry.path !== null &&
      (name.startsWith(entry.name.toLowerCase()) ||
        (entry.id === 'openai' && name.startsWith('codex'))),
  )
  return brand?.path ?? null
}

export type AgentAvatarSize = 'xs' | 'sm' | 'md' | 'lg'

/**
 * The one sign of an agent everywhere in Kore: its real logo on a round
 * tile. While it works, a thin accent arc turns around the tile; that ring is
 * the only colour an agent ever brings. The editor builds the same markup in
 * plain DOM (`agentAvatarElement`), so both stay one shape.
 */
export function AgentAvatar({
  agent,
  size,
  working,
  className,
}: {
  agent: string
  size: AgentAvatarSize
  working: boolean
  className?: string
}): ReactElement {
  const path = agentBrandPath(agent)
  return (
    <span
      aria-hidden
      className={cn('kore-agent-avatar', className)}
      data-size={size}
      data-working={working ? 'true' : 'false'}
    >
      {path === null ? (
        <span className="kore-agent-avatar-initial">{agent.slice(0, 1)}</span>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d={path} />
        </svg>
      )}
      <svg className="kore-agent-avatar-ring" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="16.5" pathLength="100" />
      </svg>
    </span>
  )
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** {@link AgentAvatar}'s markup for ProseMirror widgets, which render outside React. */
export function agentAvatarElement(
  agent: string,
  size: AgentAvatarSize,
  working: boolean,
): HTMLElement {
  const root = document.createElement('span')
  root.className = 'kore-agent-avatar'
  root.setAttribute('aria-hidden', 'true')
  root.dataset['size'] = size
  root.dataset['working'] = working ? 'true' : 'false'
  const path = agentBrandPath(agent)
  if (path === null) {
    const initial = document.createElement('span')
    initial.className = 'kore-agent-avatar-initial'
    initial.textContent = agent.slice(0, 1)
    root.append(initial)
  } else {
    const logo = document.createElementNS(SVG_NS, 'svg')
    logo.setAttribute('viewBox', '0 0 24 24')
    logo.setAttribute('fill', 'currentColor')
    const shape = document.createElementNS(SVG_NS, 'path')
    shape.setAttribute('d', path)
    logo.append(shape)
    root.append(logo)
  }
  const ring = document.createElementNS(SVG_NS, 'svg')
  ring.setAttribute('class', 'kore-agent-avatar-ring')
  ring.setAttribute('viewBox', '0 0 36 36')
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', '18')
  circle.setAttribute('cy', '18')
  circle.setAttribute('r', '16.5')
  circle.setAttribute('pathLength', '100')
  ring.append(circle)
  root.append(ring)
  return root
}
