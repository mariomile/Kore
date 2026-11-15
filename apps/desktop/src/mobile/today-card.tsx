import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOpenTasks, taskViewsFor, type OpenTask } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { taskKey } from '@/lib/tasks/task-identity'
import { tasksQueryKey } from '@/lib/tasks/tasks-query'
import { useTaskActions } from '@/lib/tasks/use-task-actions'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

const MAX_ROWS = 5

/** Hold the open-task query off the launch path: the daily is the first screen. */
const QUERY_DELAY_MS = 1500

/** The due date already shows as the card's subject; drop it from the row text. */
function stripDueDate(text: string): string {
  return text.replaceAll(/\s*(?:📅\s*)?\[{0,2}\d{4}-\d{2}-\d{2}\]{0,2}/g, '').trim() || text
}

/**
 * iPhone design pass (2026-11): today's slide opens on what
 * the day holds. Tasks due today that live in other notes sit in one card
 * above the daily's own text, checkable in place; the daily's own tasks are
 * already in the note below, so they stay out. Shares the Tasks tab's cached
 * open-task query, started a beat after the daily mounts so it stays off the
 * launch path.
 */
export function TodayCard({ day }: { day: string }): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { navigate } = useRouter()
  const actions = useTaskActions()
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), QUERY_DELAY_MS)
    return () => clearTimeout(id)
  }, [])
  const { data: open } = useQuery({
    queryKey: tasksQueryKey(graph?.root),
    queryFn: () => getOpenTasks(),
    enabled: settled && bridgeReady && graph !== null,
  })

  const due = useMemo(
    () =>
      (open ?? [])
        .filter((task) => task.dailyDate !== day && taskViewsFor(task, day).includes('today'))
        .slice(0, MAX_ROWS),
    [open, day],
  )

  if (due.length === 0) {
    return null
  }

  return (
    <section
      aria-label="Due today"
      className="mx-4 mt-3 mb-1 rounded-2xl bg-background px-3.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06)]"
    >
      {due.map((task: OpenTask, index) => (
        <div
          key={taskKey(task)}
          className={cn(
            'flex min-h-11 items-center gap-3 text-[16px]',
            index > 0 && 'border-t border-border/70',
          )}
        >
          <button
            type="button"
            aria-label={`Complete ${task.text}`}
            onClick={() => {
              hapticImpactLight()
              actions.complete([task])
            }}
            className="size-[22px] shrink-0 rounded-full border-[1.5px] border-text-muted/50 transition-transform active:scale-90"
          />
          <button
            type="button"
            onClick={() => navigate(routeForPath(task.notePath))}
            className="min-w-0 flex-1 truncate text-left"
          >
            {stripDueDate(task.text)}
          </button>
          {task.dueTime !== null ? (
            <span className="shrink-0 text-[14px] text-text-muted tabular-nums">
              {task.dueTime}
            </span>
          ) : task.dueDate !== null && task.dueDate < day ? (
            <span className="shrink-0 text-[14px] text-[#ff9500]">overdue</span>
          ) : null}
        </div>
      ))}
    </section>
  )
}
