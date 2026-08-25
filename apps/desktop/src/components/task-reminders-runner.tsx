import { useCallback, useEffect, useRef } from 'react'
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification'
import { getOpenTasks, type OpenTask } from '@reflect/core'
import { todayIso } from '@/lib/dates'
import { useFileChanges } from '@/lib/use-file-changes'
import {
  digestCounts,
  parsePunctualFireState,
  punctualReminderBody,
  punctualTaskKey,
  punctualTasksReady,
  serializePunctualFireState,
} from '@/lib/task-reminders'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/** How often the due check runs while the app is open. */
const CHECK_INTERVAL_MS = 60_000

/** Per-graph localStorage key: the last local day a reminder was sent. */
export function taskRemindersCacheKey(graphRoot: string): string {
  return `reflect.taskReminders.lastDay:${graphRoot}`
}

/** Per-graph localStorage key: punctual task notifications already fired today. */
export function taskRemindersPunctualCacheKey(graphRoot: string): string {
  return `reflect.taskReminders.punctual:${graphRoot}`
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
 * day summarizing date-only tasks due today and every overdue task. Timed
 * tasks (`[[YYYY-MM-DD]] @HH:MM`) fire once at that local time instead of
 * joining the morning digest. The sent-day marker lives in localStorage per
 * graph, so switching graphs can't suppress a reminder and a re-render can't
 * double-send one.
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
  // The minute tick reuses one cached open-task query: a vault edit (any
  // file change), a new day, or a graph switch invalidates it, so quiet
  // minutes cost no index round-trip at all.
  const tasksCacheRef = useRef<{ tasks: OpenTask[]; day: string; root: string } | null>(null)
  useFileChanges(
    useCallback(() => {
      tasksCacheRef.current = null
    }, []),
  )

  useEffect(() => {
    async function checkDueTasks(): Promise<void> {
      const graph = graphRef.current
      if (graph === null || !settingsRef.current.taskReminders) {
        return
      }
      if (!(await isPermissionGranted().catch(() => false))) {
        return
      }
      const today = todayIso()
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      let cache = tasksCacheRef.current
      if (cache === null || cache.day !== today || cache.root !== graph.root) {
        cache = { tasks: await getOpenTasks().catch(() => []), day: today, root: graph.root }
        tasksCacheRef.current = cache
      }
      const tasks = cache.tasks
      const punctualKey = taskRemindersPunctualCacheKey(graph.root)
      let fired = new Set<string>()
      try {
        fired = parsePunctualFireState(localStorage.getItem(punctualKey), today)
      } catch {
        fired = new Set()
      }
      const ready = punctualTasksReady(tasks, today, nowMinutes, fired)
      for (const task of ready) {
        sendNotification({ title: 'Task due', body: punctualReminderBody(task) })
        fired.add(punctualTaskKey(task))
      }
      if (ready.length > 0) {
        try {
          localStorage.setItem(punctualKey, serializePunctualFireState(today, fired))
        } catch {
          // Storage unavailable — better a repeated punctual reminder than none.
        }
      }
      const digestKey = taskRemindersCacheKey(graph.root)
      try {
        if (localStorage.getItem(digestKey) === today) {
          return
        }
      } catch {
        // Storage unavailable — better a repeated digest than none.
      }
      const counts = digestCounts(tasks, today)
      const body = taskReminderBody(counts.dueToday, counts.overdue)
      // A no-tasks day still marks the digest done: the point is one summary
      // per day. Timed tasks keep firing on later checks via the punctual set.
      try {
        localStorage.setItem(digestKey, today)
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
