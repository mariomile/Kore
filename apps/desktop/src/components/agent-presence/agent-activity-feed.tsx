import { useEffect } from 'react'
import { agentActivitySince, parseAgentActivity } from '@kore/core'
import { agentPresenceStore } from '@/lib/agent-presence'

/** How often the log is checked: a `stat` when nothing changed. */
const POLL_MS = 1_000

/**
 * Events this old when the vault opens are history, not presence: an
 * agent that wrote a minute ago is still worth showing, yesterday's is not.
 */
const RECENT_MS = 60_000

/**
 * Feeds what outside agents do through `kore mcp` (the CLI's live activity
 * log) into the presence picture, on the Mac where that CLI runs beside the
 * app. Headless; one per workspace. Pauses while the window is hidden and
 * catches up when it is back, so an idle app costs one `stat` a second.
 */
export function AgentActivityFeed({ generation }: { generation: number }): null {
  useEffect(() => {
    let offset = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let stopped = false

    const schedule = (): void => {
      if (!stopped && !document.hidden) {
        timer = setTimeout(() => void tick(), POLL_MS)
      }
    }
    const tick = async (): Promise<void> => {
      timer = null
      inFlight = true
      let chunk: Awaited<ReturnType<typeof agentActivitySince>>
      try {
        chunk = await agentActivitySince(offset, generation)
      } catch {
        // The vault moved on (a switch) or this host has no log to read:
        // presence is a nicety, so the feed just stops.
        stopped = true
        return
      } finally {
        inFlight = false
      }
      if (stopped) {
        return
      }
      offset = chunk.offset
      for (const event of parseAgentActivity(chunk.text, Date.now() - RECENT_MS)) {
        agentPresenceStore.apply(event)
      }
      schedule()
    }
    const onVisibility = (): void => {
      // Back from hidden: catch up at once (the last minute still shows).
      if (!document.hidden && timer === null && !inFlight && !stopped) {
        void tick()
      }
    }

    void tick()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [generation])
  return null
}
