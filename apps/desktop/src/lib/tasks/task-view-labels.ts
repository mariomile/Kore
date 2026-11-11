import type { TaskView } from '@kore/core'

const LABELS: Readonly<Record<TaskView, string>> = {
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
  projects: 'Projects',
  all: 'All',
}

/** A Tasks view's display label, shared by the desktop tabs and the mobile chips. */
export function taskViewLabel(view: TaskView): string {
  return LABELS[view]
}
