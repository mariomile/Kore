import { useEffect, useRef } from 'react'
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification'
import { getOpenTasks } from '@reflect/core'
import { todayIso } from '@/lib/dates'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/** How often the due check runs while the app is open. */
const CHECK_INTERVAL_MS = 60_000

/** Per-graph localStorage key: the last local day a reminder was sent. */
export function taskRemindersCacheKey(graphRoot: string): string {
  return `reflect.taskReminders.lastDay:${graphRoot}`
}

/** The one-per-day summary line, or null when nothing is due. */
export function taskReminderBody(dueToday: number, overdue: number): string | null {
  if (dueToday === 0 && overdue === 0) {
    return null
  }
  const parts: string[] = []
  if (dueToday > 0) {
    parts.push(`${dueToday} task${dueToday === 1 ? '' : 's'} due today`)
  }
  if (overdue > 0) {
    parts.push(`${overdue} overdue`)
  }
  return parts.join(', ')
}

/**
 * The task-reminders runner: an invisible resident of the workspace that,
 * when the setting is on, sends at most one native notification per local
 * day summarizing the open tasks due today and the overdue ones. Task due
 * dates are date-only, so the reminder fires on the first check of the day
 * the app is awake for — launch included. The sent-day marker lives in
 * localStorage per graph, so switching graphs can't suppress a reminder and
 * a re-render can't double-send one.
 */
export function TaskRemindersRunner(): null {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const runningRef = useRef(false)
  const settingsRef = useRef(settings)
  const graphRef = useRef(graph)
  useEffect(() => {
    settingsRef.current = settings
    graphRef.current = graph
  })

  useEffect(() => {
    async function checkDueTasks(): Promise<void> {
      const graph = graphRef.current
      if (graph === null || !settingsRef.current.taskReminders) {
        return
      }
      const today = todayIso()
      const cacheKey = taskRemindersCacheKey(graph.root)
      try {
        if (localStorage.getItem(cacheKey) === today) {
          return
        }
      } catch {
        // Storage unavailable — better a repeated reminder than none.
      }
      if (!(await isPermissionGranted().catch(() => false))) {
        return
      }
      const tasks = await getOpenTasks().catch(() => [])
      const due = tasks.filter((task) => task.dueDate !== null && task.dueDate <= today)
      const overdue = due.filter((task) => task.dueDate !== null && task.dueDate < today).length
      const body = taskReminderBody(due.length - overdue, overdue)
      // A no-tasks day still marks itself done: the point is one check per
      // day, not a poll that re-runs every minute until something is due.
      try {
        localStorage.setItem(cacheKey, today)
      } catch {
        // Ignored — see above.
      }
      if (body !== null) {
        sendNotification({ title: 'Tasks due', body })
      }
    }

    const check = (): void => {
      if (runningRef.current) {
        return
      }
      runningRef.current = true
      void checkDueTasks().finally(() => {
        runningRef.current = false
      })
    }
    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
    // Refs carry the live settings/graph; the loop itself never re-arms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
