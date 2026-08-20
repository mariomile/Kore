import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { AgentRoutine, Settings } from '@reflect/core'

const settingsState = vi.hoisted(() => ({
  agentRoutines: [] as AgentRoutine[],
}))
const updated = vi.hoisted(() => [] as Partial<Settings>[])
vi.mock('@/providers/settings-provider', () => ({
  SETTINGS_QUERY_KEY: ['settings'],
  useSettings: () => ({
    settings: { agentRoutines: settingsState.agentRoutines },
    updateSettings: (patch: Partial<Settings>) => {
      updated.push(patch)
    },
    updateSettingsWith: (
      updater: (current: { agentRoutines: AgentRoutine[] }) => Partial<Settings>,
    ) => {
      updated.push(updater({ agentRoutines: settingsState.agentRoutines }))
    },
  }),
}))

const { AgentRoutinesSection } = await import('./agent-routines-section')
const { ROUTINES_CHECK_EVENT } = await import('@/components/agent-routines-runner')

const BRIEF: AgentRoutine = {
  id: 'brief',
  name: 'Morning brief',
  agentSlug: 'riley',
  prompt: 'Prepare the daily brief.',
  schedule: { kind: 'daily', time: '08:00' },
  enabled: true,
  lastRunMs: Date.now(),
  lastChangedPaths: [],
}

const RILEY = {
  slug: 'riley',
  name: 'Riley',
  provider: null,
  model: null,
  soulPath: 'agents/riley/soul.md',
  memoryPath: 'agents/riley/memory.md',
}

function reset(routines: AgentRoutine[]): void {
  settingsState.agentRoutines = routines
  updated.length = 0
}

describe('AgentRoutinesSection', () => {
  it('lists a routine with its schedule, agent, and controls', async () => {
    reset([BRIEF])
    const view = await render(<AgentRoutinesSection profiles={[RILEY]} />)
    await expect.element(view.getByText('Morning brief')).toBeVisible()
    await expect.element(view.getByText(/Daily at 08:00 · Riley · ran today/)).toBeVisible()

    await view.getByRole('switch', { name: 'Morning brief enabled' }).click()
    expect(updated.at(-1)?.agentRoutines?.[0]).toMatchObject({ id: 'brief', enabled: false })

    await view.getByRole('button', { name: 'Delete Morning brief' }).click()
    expect(updated.at(-1)?.agentRoutines).toEqual([])
    await view.unmount()
  })

  it('Run now clears the last-run stamp and pokes the runner', async () => {
    reset([BRIEF])
    const poked = vi.fn()
    window.addEventListener(ROUTINES_CHECK_EVENT, poked)
    const view = await render(<AgentRoutinesSection profiles={[]} />)
    await view.getByRole('button', { name: 'Run Morning brief now' }).click()
    expect(updated.at(-1)?.agentRoutines?.[0]).toMatchObject({
      id: 'brief',
      lastRunMs: null,
      lastChangedPaths: [],
      enabled: true,
    })
    expect(poked).toHaveBeenCalled()
    window.removeEventListener(ROUTINES_CHECK_EVENT, poked)
    await view.unmount()
  })

  it('adds the Memory curator preset with its weekly schedule', async () => {
    reset([])
    const view = await render(<AgentRoutinesSection profiles={[]} />)
    await view.getByRole('button', { name: 'Add Memory curator' }).click()
    const added = updated.at(-1)?.agentRoutines?.[0]
    expect(added).toMatchObject({
      name: 'Memory curator',
      agentSlug: null,
      enabled: true,
      schedule: { kind: 'weekly', weekday: 0, time: '18:00' },
    })
    expect(added?.prompt).toContain('agents/memory/facts.md')
    await view.unmount()
  })

  it('creates a custom automation from the dialog', async () => {
    reset([])
    const view = await render(<AgentRoutinesSection profiles={[RILEY]} />)
    await view.getByRole('button', { name: 'New automation' }).click()
    await view.getByLabelText('Automation name').fill('Inbox sweep')
    await view.getByLabelText('Automation prompt').fill('Process the inbox notes.')
    await view.getByRole('button', { name: 'Create automation' }).click()
    const added = updated.at(-1)?.agentRoutines?.[0]
    expect(added).toMatchObject({
      name: 'Inbox sweep',
      prompt: 'Process the inbox notes.',
      agentSlug: null,
      schedule: { kind: 'daily', time: '08:00' },
      enabled: true,
    })
    expect(added?.lastRunMs).not.toBeNull()
    await view.unmount()
  })
})
