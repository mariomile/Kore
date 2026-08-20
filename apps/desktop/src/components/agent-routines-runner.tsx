import { useEffect, useRef } from 'react'
import {
  errorMessage,
  isCliAgentProvider,
  listPrivateNotePaths,
  loadAgentContext,
  routineIsDue,
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

    async function runRoutine(routine: AgentRoutine): Promise<void> {
      const graph = graphRef.current
      if (graph === null) {
        return
      }
      markRun(routine.id, Date.now())
      try {
        const context = await loadAgentContext(routine.agentSlug)
        const configured = settingsRef.current.aiProviders
          .map((entry) => entry.provider)
          .filter(isCliAgentProvider)
        const pinned = configured.find((kind) => kind === context.profile?.provider)
        const provider = pinned ?? configured[0]
        if (provider === undefined) {
          toast.add({
            type: 'error',
            title: `Routine “${routine.name}” skipped`,
            description: 'It needs a Claude Code or Codex provider configured in Settings → AI.',
          })
          return
        }
        const privateNotePaths = await listPrivateNotePaths()
        const events = streamCliAgentChat(provider, {
          model: context.profile?.model ?? 'default',
          messages: [{ role: 'user', content: `${routine.prompt}\n${ROUTINE_RUN_SUFFIX}` }],
          today: todayIso(),
          customSystemPrompt: settingsRef.current.chatSystemPrompt,
          graphRoot: graph.root,
          graphName: graph.name,
          privateNotePaths,
          allowEdits: true,
          agentContext: context,
          memoryWriteApproval: settingsRef.current.memoryWriteApproval,
        })
        let failure: string | null = null
        for await (const event of events) {
          if (event.type === 'error') {
            failure = event.message
          }
        }
        if (failure === null) {
          toast.add({ title: `Routine “${routine.name}” completed` })
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
          await runRoutine(routine)
        }
      } finally {
        runningRef.current = false
      }
    }

    const check = (): void => {
      void runDueRoutines()
    }
    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    window.addEventListener(ROUTINES_CHECK_EVENT, check)
    return () => {
      clearInterval(timer)
      window.removeEventListener(ROUTINES_CHECK_EVENT, check)
    }
    // Refs carry the live settings/graph; the loop itself never re-arms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
