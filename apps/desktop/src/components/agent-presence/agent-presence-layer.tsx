import { lazy, Suspense, type ReactElement } from 'react'
import { AgentPresencePills } from './agent-presence-pill'

// The scripted agent exists only in the dev harness; production never
// loads the chunk.
const AgentPresenceDemo =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('agentDemo')
    ? lazy(() =>
        import('@/dev/agent-presence-demo').then((module) => ({
          default: module.AgentPresenceDemo,
        })),
      )
    : null

/** The agents-at-work overlay: the floating pills, plus the dev script when asked. */
export function AgentPresenceLayer({ className }: { className?: string }): ReactElement {
  return (
    <>
      <AgentPresencePills {...(className !== undefined ? { className } : {})} />
      {AgentPresenceDemo !== null ? (
        <Suspense fallback={null}>
          <AgentPresenceDemo />
        </Suspense>
      ) : null}
    </>
  )
}
