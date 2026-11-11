import { clearTaskDueDate, setTaskDueDate, type OpenTask } from '@kore/core'
import { taskContent } from '@/lib/tasks/task-content'

/** Return the task content after setting or clearing its scheduled date link. */
export function scheduledContent(task: OpenTask, isoDate: string | null): string {
  const content = taskContent(task.raw)
  return isoDate === null ? clearTaskDueDate(content) : setTaskDueDate(content, isoDate)
}
