import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import {
  agentRoutinesSchema,
  inflightRoutineRun,
  markRoutineRunStarted,
  markRoutineRunFinished,
  subscribeNativeRoutineTick,
  withAgentRunLock,
  runRoutineScriptTick,
  type AgentRoutine,
} from '@reflect/core'
import { AgentRoutinesRunner } from './agent-routines-runner'

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  inflightRoutineRun: vi.fn(),
  markRoutineRunStarted: vi.fn(),
  markRoutineRunFinished: vi.fn(),
  subscribeNativeRoutineTick: vi.fn(),
  withAgentRunLock: vi.fn(),
  runRoutineScriptTick: vi.fn(),
}))
const state = vi.hoisted(() => ({ routines: [] as AgentRoutine[] }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/work', generation: 1 }, indexGeneration: 1 }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { agentRoutines: state.routines },
    updateSettingsWith: (
      update: (current: { agentRoutines: AgentRoutine[] }) => {
        agentRoutines?: AgentRoutine[]
      },
    ) => {
      state.routines = update({ agentRoutines: state.routines }).agentRoutines ?? state.routines
    },
  }),
}))
vi.mock('@/components/ui/toast', () => ({ toast: { add: vi.fn() } }))

afterEach(async () => {
  await cleanup()
  vi.clearAllMocks()
})

it('runs only the current graph and aborts its preliminary script on unmount', async () => {
  state.routines = agentRoutinesSchema.parse(
    ['other', 'unassigned', 'current'].map((id) => ({
      id,
      graphRoot: id === 'other' ? '/other' : id === 'unassigned' ? null : '/work',
      name: id,
      agentSlug: 'curator',
      prompt: 'Review',
      script: 'sleep 30',
      enabled: true,
      schedule: { kind: 'daily', time: '00:00' },
    })),
  )
  expect(state.routines).toHaveLength(3)
  vi.mocked(inflightRoutineRun).mockResolvedValue(null)
  vi.mocked(markRoutineRunStarted).mockResolvedValue(undefined)
  vi.mocked(markRoutineRunFinished).mockResolvedValue(undefined)
  vi.mocked(subscribeNativeRoutineTick).mockResolvedValue(() => {})
  vi.mocked(withAgentRunLock).mockImplementation(async (work) => await work())
  let scriptSignal: AbortSignal | undefined
  vi.mocked(runRoutineScriptTick).mockImplementation(async (_script, _generation, signal) => {
    scriptSignal = signal
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    signal.throwIfAborted()
    return { code: 0, stdout: '', stderr: '', timedOut: false }
  })
  const view = await render(<AgentRoutinesRunner />)
  await expect.poll(() => scriptSignal).toBeDefined()
  expect(markRoutineRunStarted).toHaveBeenCalledWith(1, 'current', expect.any(Number))
  expect(runRoutineScriptTick).toHaveBeenCalledTimes(1)
  await view.unmount()
  expect(scriptSignal?.aborted).toBe(true)
  await expect.poll(() => markRoutineRunFinished).toHaveBeenCalledTimes(1)
  expect(state.routines.find((routine) => routine.id === 'current')?.consecutiveFailures).toBe(0)
})
