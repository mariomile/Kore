import { useEffect, useRef } from 'react'
import {
  errorMessage,
  isCliAgentProvider,
  listPrivateNotePaths,
  gitAgentSnapshot,
  gitChangedSince,
  loadAgentContext,
  resolveMcpServers,
  routineIsDue,
  withAgentRunLock,
  streamCliAgentChat,
  ROUTINE_RUN_SUFFIX,
  type AgentRoutine,
} from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { todayIso } from '@/lib/dates'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/** How often due routines are looked for while the app is open. */
const CHECK_INTERVAL_MS = 60_000

/** "Run now" and freshly created routines poke the runner through this event. */
export const ROUTINES_CHECK_EVENT = 'agent-routines:check'

/**
 * "Run now" from the Agents screen: fires one routine immediately by id,
 * dueness ignored. A dedicated event (with the id in `detail`) rather than
 * a dueness re-check, because the click handler dispatches before React has
 * flushed any settings change into the runner's ref — a re-check would see
 * stale state and wait for the next minute tick.
 */
export const ROUTINE_RUN_NOW_EVENT = 'agent-routines:run-now'

/**
 * The automations runner: an invisible resident of the workspace that fires
 * due agent routines (see `@reflect/core`'s `agent-routines`) while the app
 * is open. A due routine runs headless through the agent CLI providers in
 * edit mode — the same sandbox and memory digest as an edit-mode chat turn,
 * so private notes stay fenced and the run journals itself like any session.
 *
 * `lastRunMs` is stamped *before* the run starts: a crash mid-run must not
 * make the routine re-fire every minute. Missed schedules catch up on the
 * next check (launch included) — the due rule lives in `routineIsDue`.
 * Routines run one at a time; a slow one delays the next, never overlaps it.
 */
export function AgentRoutinesRunner(): null {
  const { graph } = useGraph()
  const { settings, updateSettingsWith } = useSettings()
  const runningRef = useRef(false)
  const settingsRef = useRef(settings)
  const graphRef = useRef(graph)
  useEffect(() => {
    settingsRef.current = settings
    graphRef.current = graph
  })

  useEffect(() => {
    const markRun = (id: string, startedMs: number): void => {
      updateSettingsWith((current) => ({
        agentRoutines: current.agentRoutines.map((routine) =>
          routine.id === id ? { ...routine, lastRunMs: startedMs } : routine,
        ),
      }))
    }

    const recordLedger = (id: string, paths: string[]): void => {
      updateSettingsWith((current) => ({
        agentRoutines: current.agentRoutines.map((routine) =>
          routine.id === id ? { ...routine, lastChangedPaths: paths } : routine,
        ),
      }))
    }

    async function runRoutine(routine: AgentRoutine): Promise<void> {
      const graph = graphRef.current
      if (graph === null) {
        return
      }
      try {
        const context = await loadAgentContext(routine.agentSlug)
        const configured = settingsRef.current.aiProviders
          .map((entry) => entry.provider)
          .filter(isCliAgentProvider)
        const pinned = configured.find((kind) => kind === context.profile?.provider)
        const provider = pinned ?? configured[0]
        if (provider === undefined) {
          // Deliberately BEFORE markRun: a skipped occurrence is not
          // consumed — configure a provider and the routine still fires.
          toast.add({
            type: 'error',
            title: `Routine “${routine.name}” skipped`,
            description: 'It needs a Claude Code or Codex provider configured in Settings → AI.',
          })
          return
        }
        markRun(routine.id, Date.now())
        const privateNotePaths = await listPrivateNotePaths()
        const mcpServers = await resolveMcpServers(settingsRef.current.mcpServers).catch(() => [])
        // Activity ledger baseline: commit pending changes so the run's
        // touches diff cleanly against a restorable version.
        const snapshot = await gitAgentSnapshot(graph.generation).catch(() => null)
        const events = streamCliAgentChat(provider, {
          // The pinned model only makes sense on the pinned provider — on a
          // fallback provider it would name a model that engine doesn't have.
          model: pinned !== undefined ? (context.profile?.model ?? 'default') : 'default',
          messages: [{ role: 'user', content: `${routine.prompt}\n${ROUTINE_RUN_SUFFIX}` }],
          today: todayIso(),
          customSystemPrompt: settingsRef.current.chatSystemPrompt,
          graphRoot: graph.root,
          graphName: graph.name,
          privateNotePaths,
          allowEdits: true,
          agentContext: context,
          mcpServers,
          memoryWriteApproval: settingsRef.current.memoryWriteApproval,
        })
        let failure: string | null = null
        for await (const event of events) {
          if (event.type === 'error') {
            failure = event.message
          }
        }
        const changed =
          snapshot === null ? [] : await gitChangedSince(snapshot, graph.generation).catch(() => [])
        const ledger = changed.filter((path) => path.toLowerCase().endsWith('.md'))
        recordLedger(routine.id, ledger)
        if (failure === null) {
          toast.add({
            title: `Routine “${routine.name}” completed`,
            ...(ledger.length > 0
              ? {
                  description: `${ledger.length} note${ledger.length === 1 ? '' : 's'} edited — see Agents → Automations.`,
                }
              : {}),
          })
        } else {
          toast.add({
            type: 'error',
            title: `Routine “${routine.name}” failed`,
            description: failure,
          })
        }
      } catch (cause: unknown) {
        toast.add({
          type: 'error',
          title: `Routine “${routine.name}” failed`,
          description: errorMessage(cause),
        })
      }
    }

    async function runDueRoutines(): Promise<void> {
      if (runningRef.current || graphRef.current === null) {
        return
      }
      const now = new Date()
      const due = settingsRef.current.agentRoutines.filter((routine) => routineIsDue(routine, now))
      if (due.length === 0) {
        return
      }
      runningRef.current = true
      try {
        for (const routine of due) {
          // Edit-mode agent runs are serialized app-wide (the chat holds the
          // same lock) so concurrent runs can't cross-attribute ledgers.
          await withAgentRunLock(() => runRoutine(routine))
        }
      } finally {
        runningRef.current = false
      }
    }

    const check = (): void => {
      void runDueRoutines()
    }
    const runNow = (event: Event): void => {
      const id = event instanceof CustomEvent ? String(event.detail ?? '') : ''
      const routine = settingsRef.current.agentRoutines.find((entry) => entry.id === id)
      if (routine === undefined || runningRef.current) {
        return
      }
      runningRef.current = true
      void withAgentRunLock(() => runRoutine(routine)).finally(() => {
        runningRef.current = false
      })
    }
    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    window.addEventListener(ROUTINES_CHECK_EVENT, check)
    window.addEventListener(ROUTINE_RUN_NOW_EVENT, runNow)
    return () => {
      clearInterval(timer)
      window.removeEventListener(ROUTINES_CHECK_EVENT, check)
      window.removeEventListener(ROUTINE_RUN_NOW_EVENT, runNow)
    }
    // Refs carry the live settings/graph; the loop itself never re-arms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
