import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

const notification = vi.hoisted(() => ({
  granted: true,
  sent: [] as { title: string; body: string }[],
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: () => Promise.resolve(notification.granted),
  requestPermission: () => Promise.resolve('granted'),
  sendNotification: (options: { title: string; body: string }) => {
    notification.sent.push(options)
  },
}))

const core = vi.hoisted(() => ({
  tasks: [] as {
    notePath?: string
    markerOffset?: number
    text?: string
    dueDate: string | null
    dueTime?: string | null
  }[],
}))
vi.mock('@reflect/core', () => ({
  getOpenTasks: () => Promise.resolve(core.tasks),
}))

const state = vi.hoisted(() => ({
  taskReminders: true,
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({ settings: { taskReminders: state.taskReminders } }),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/vault', name: 'Vault', generation: 1 } }),
}))

const {
  TaskRemindersRunner,
  taskReminderBody,
  taskRemindersCacheKey,
  taskRemindersPunctualCacheKey,
} = await import('./task-reminders-runner')
const { todayIso, addDaysIso } = await import('@/lib/dates')

/** The runner's first check settles asynchronously; poll until it lands. */
async function settled(): Promise<void> {
  await vi.waitFor(() => {
    expect(localStorage.getItem(taskRemindersCacheKey('/vault'))).not.toBeNull()
  })
}

describe('taskReminderBody', () => {
  it('summarizes the counts, dropping empty parts', () => {
    expect(taskReminderBody(0, 0)).toBeNull()
    expect(taskReminderBody(1, 0)).toBe('1 task due today')
    expect(taskReminderBody(2, 0)).toBe('2 tasks due today')
    expect(taskReminderBody(0, 3)).toBe('3 overdue')
    expect(taskReminderBody(2, 1)).toBe('2 tasks due today, 1 overdue')
  })
})

describe('TaskRemindersRunner', () => {
  beforeEach(() => {
    localStorage.removeItem(taskRemindersCacheKey('/vault'))
    localStorage.removeItem(taskRemindersPunctualCacheKey('/vault'))
    notification.sent.length = 0
    notification.granted = true
    state.taskReminders = true
    core.tasks = []
  })

  it('sends one daily summary of due and overdue tasks', async () => {
    const today = todayIso()
    core.tasks = [
      { dueDate: today },
      { dueDate: addDaysIso(today, -2) },
      { dueDate: addDaysIso(today, 3) },
      { dueDate: null },
    ]
    const view = await render(<TaskRemindersRunner />)
    await settled()
    expect(notification.sent).toEqual([{ title: 'Tasks due', body: '1 task due today, 1 overdue' }])
    expect(localStorage.getItem(taskRemindersCacheKey('/vault'))).toBe(today)
    await view.unmount()
  })

  it('marks a no-tasks day done without notifying', async () => {
    const view = await render(<TaskRemindersRunner />)
    await settled()
    expect(notification.sent).toEqual([])
    expect(localStorage.getItem(taskRemindersCacheKey('/vault'))).toBe(todayIso())
    await view.unmount()
  })

  it('never re-sends on the same day', async () => {
    localStorage.setItem(taskRemindersCacheKey('/vault'), todayIso())
    core.tasks = [{ dueDate: todayIso() }]
    const view = await render(<TaskRemindersRunner />)
    // The marker predates the mount, so settled() would pass vacuously —
    // give the check a beat to run instead.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(notification.sent).toEqual([])
    await view.unmount()
  })

  it('stays silent while notification permission is missing', async () => {
    notification.granted = false
    core.tasks = [{ dueDate: todayIso() }]
    const view = await render(<TaskRemindersRunner />)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(notification.sent).toEqual([])
    // No permission → the day is NOT consumed; granting it later still
    // delivers today's reminder.
    expect(localStorage.getItem(taskRemindersCacheKey('/vault'))).toBeNull()
    expect(localStorage.getItem(taskRemindersPunctualCacheKey('/vault'))).toBeNull()
    await view.unmount()
  })

  it('notifies a timed task at its clock time and keeps it out of the digest', async () => {
    const today = todayIso()
    core.tasks = [
      {
        notePath: 'notes/a.md',
        markerOffset: 4,
        text: 'Dentist',
        dueDate: today,
        dueTime: '00:00',
      },
    ]
    const view = await render(<TaskRemindersRunner />)
    await settled()
    expect(notification.sent).toEqual([{ title: 'Task due', body: 'Dentist · 00:00' }])
    await view.unmount()
  })

  it('still fires a timed task after the daily digest has already been sent', async () => {
    const today = todayIso()
    localStorage.setItem(taskRemindersCacheKey('/vault'), today)
    core.tasks = [
      {
        notePath: 'notes/a.md',
        markerOffset: 4,
        text: 'Dentist',
        dueDate: today,
        dueTime: '00:00',
      },
    ]
    const view = await render(<TaskRemindersRunner />)
    await vi.waitFor(() => {
      expect(notification.sent).toEqual([{ title: 'Task due', body: 'Dentist · 00:00' }])
    })
    expect(localStorage.getItem(taskRemindersPunctualCacheKey('/vault'))).not.toBeNull()
    await view.unmount()
  })
})
