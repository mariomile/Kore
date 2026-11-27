import { lazy, Suspense, type ReactElement } from 'react'
import { AgentPresenceCapsules } from './agent-presence-capsule'

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

/** Agents at work: the capsules, plus the dev script when asked. */
export function AgentPresenceLayer({ className }: { className?: string }): ReactElement {
  return (
    <>
      <AgentPresenceCapsules {...(className !== undefined ? { className } : {})} />
      {AgentPresenceDemo !== null ? (
        <Suspense fallback={null}>
          <AgentPresenceDemo />
        </Suspense>
      ) : null}
    </>
  )
}
