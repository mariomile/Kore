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
const { ROUTINE_RUN_NOW_EVENT } = await import('@/components/agent-routines-runner')

const BRIEF: AgentRoutine = {
  id: 'brief',
  name: 'Morning brief',
  agentSlug: 'riley',
  prompt: 'Prepare the daily brief.',
  script: null,
  schedule: { kind: 'daily', time: '08:00' },
  enabled: true,
  lastRunMs: Date.now(),
  lastChangedPaths: [],
  runs: [],
  consecutiveFailures: 0,
  retryAtMs: null,
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

  it('Run now fires the routine by id, dueness ignored', async () => {
    reset([BRIEF])
    const fired = vi.fn((event: Event) => (event as CustomEvent).detail as string)
    window.addEventListener(ROUTINE_RUN_NOW_EVENT, fired)
    const view = await render(<AgentRoutinesSection profiles={[]} />)
    await view.getByRole('button', { name: 'Run Morning brief now' }).click()
    expect(fired).toHaveBeenCalled()
    expect(fired.mock.results[0]?.value).toBe('brief')
    window.removeEventListener(ROUTINE_RUN_NOW_EVENT, fired)
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

  it('shows the run history dialog — outcomes, errors, and touched notes', async () => {
    reset([
      {
        ...BRIEF,
        runs: [
          {
            startedMs: new Date(2026, 7, 21, 8, 0).getTime(),
            status: 'ok',
            error: null,
            changedPaths: ['notes/brief.md', 'agents/memory/log.md'],
          },
          {
            startedMs: new Date(2026, 7, 20, 8, 0).getTime(),
            status: 'error',
            error: 'The CLI exited with code 1.',
            changedPaths: [],
          },
        ],
      },
    ])
    const view = await render(<AgentRoutinesSection profiles={[]} />)
    await view.getByRole('button', { name: 'Run history for Morning brief' }).click()
    await expect.element(view.getByText('Morning brief — run history')).toBeVisible()
    await expect.element(view.getByText(/2 notes edited/)).toBeVisible()
    await expect.element(view.getByText('notes/brief.md')).toBeVisible()
    await expect.element(view.getByText('The CLI exited with code 1.')).toBeVisible()
    await expect.element(view.getByText('failed')).toBeVisible()
    await view.unmount()
  })

  it('hides the history button while a routine has never recorded a run', async () => {
    reset([BRIEF])
    const view = await render(<AgentRoutinesSection profiles={[]} />)
    expect(view.getByRole('button', { name: 'Run history for Morning brief' }).query()).toBeNull()
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

  it('lists a collection event routine with its trigger', async () => {
    reset([
      {
        ...BRIEF,
        id: 'on-book',
        name: 'New book',
        schedule: { kind: 'event', event: 'row-created', tag: 'books' },
      },
    ])
    const view = await render(<AgentRoutinesSection profiles={[RILEY]} />)
    await expect.element(view.getByText('New book')).toBeVisible()
    await expect.element(view.getByText(/When a #books row is created/)).toBeVisible()
    await view.unmount()
  })

  it('creates a collection event automation from the dialog', async () => {
    reset([])
    const view = await render(<AgentRoutinesSection profiles={[RILEY]} />)
    await view.getByRole('button', { name: 'New automation' }).click()
    await view.getByLabelText('Automation name').fill('On new book')
    await view.getByLabelText('Automation prompt').fill('Summarize the new book.')
    await view.getByLabelText('Schedule').click()
    await view.getByRole('option', { name: 'On collection event' }).click()
    await view.getByLabelText('Collection tag').fill('books')
    await view.getByRole('button', { name: 'Create automation' }).click()
    const added = updated.at(-1)?.agentRoutines?.[0]
    expect(added).toMatchObject({
      name: 'On new book',
      prompt: 'Summarize the new book.',
      schedule: { kind: 'event', event: 'row-created', tag: 'books' },
      enabled: true,
    })
    await view.unmount()
  })
})
