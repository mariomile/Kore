import { addDaysIso } from '@reflect/utils'
import {
  compareDated,
  compareNoteGroups,
  groupTasks,
  type TaskGroup,
  type TaskSection,
} from './group-tasks'
import type { OpenTask } from './queries'
import { compareTaskPriority, taskRawPriority } from './task-priority'

/**
 * The Tasks views, modelled on Todoist (analysis: `task-come-todoist.md`):
 *
 * - **Today**: Overdue (an explicit due date in the past) and Today (due today,
 *   or jotted bare in today's daily note — the daily-first capture idiom).
 * - **Upcoming**: one group per day for the next {@link UPCOMING_DAYS} days
 *   (empty days included, so a board column is always there to drop on), then
 *   Later. A task's day is its due date, else its future daily note's date.
 * - **Inbox**: bare tasks (no due date) left in past daily notes — captures
 *   still waiting for a date or a home.
 * - **Projects**: every task in a regular (non-daily) note, grouped by
 *   project, plus any task whose own line wiki-links a project (`+ [ ] call
 *   Andrea [[DeepAgent]]` jotted in a daily note counts under DeepAgent). A
 *   project is a folder note (`Projects/Kore/Kore.md` gathers every note under
 *   `Projects/Kore/`), else the task's own note.
 * - **All**: the original bucketed list ({@link groupTasks}).
 *
 * Every open task lands in at least one of Today / Upcoming / Inbox /
 * Projects; a dated task in a project note shows in both its day and its
 * project, as in Todoist. Pure: the caller supplies `today`, the folder notes
 * ({@link getProjectNotePaths}) and the task lines' project links
 * ({@link getTaskProjectLinks} through {@link linkedProjectsByTask}).
 */
export type TaskView = 'today' | 'upcoming' | 'inbox' | 'projects' | 'all'

/** The views in navigation order. */
export const TASK_VIEWS: readonly TaskView[] = ['inbox', 'today', 'upcoming', 'projects', 'all']

/** How many single-day groups Upcoming shows before folding the rest into Later. */
export const UPCOMING_DAYS = 7

/** The project a note belongs to: its path (the header opens it) and title. */
export interface TaskProject {
  readonly path: string
  readonly title: string
}

function pathParts(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0)
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '')
}

/** Whether `path` is a folder note: `…/<Name>/<Name>.md`. */
export function isFolderNotePath(path: string): boolean {
  const parts = pathParts(path)
  if (parts.length < 2) {
    return false
  }
  return stripMarkdownExtension(parts.at(-1)!) === parts.at(-2)
}

/**
 * The project of the note at `path`: the nearest enclosing folder whose folder
 * note exists in `projectNotePaths`, else the note itself.
 */
export function projectForNote(
  path: string,
  noteTitle: string,
  projectNotePaths: ReadonlySet<string>,
): TaskProject {
  const parts = pathParts(path)
  for (let depth = parts.length - 1; depth >= 1; depth -= 1) {
    const folder = parts.slice(0, depth)
    const name = folder.at(-1)!
    const candidate = [...folder, `${name}.md`].join('/')
    if (projectNotePaths.has(candidate)) {
      return { path: candidate, title: name }
    }
  }
  return { path, title: noteTitle }
}

/** A task's location key: its note and the marker's offset in that note. */
export function taskLocationKey(task: Pick<OpenTask, 'notePath' | 'markerOffset'>): string {
  return `${task.notePath}:${task.markerOffset}`
}

/** One wiki link on a task's own line ({@link getTaskProjectLinks}). */
export interface TaskLineLink {
  readonly notePath: string
  readonly markerOffset: number
  readonly targetPath: string
}

/** Task location key ({@link taskLocationKey}) → the project its line links. */
export type LinkedTaskProjects = ReadonlyMap<string, TaskProject>

/**
 * The project each task's own line links, keyed by {@link taskLocationKey}.
 * Only a link into a project counts (the folder note itself or a note under
 * its folder): linking a person or a reference note does not turn it into a
 * project. When a line links several projects, the first link wins. `links`
 * arrive in line order.
 */
export function linkedProjectsByTask(
  links: readonly TaskLineLink[],
  projectNotePaths: ReadonlySet<string>,
): Map<string, TaskProject> {
  const linked = new Map<string, TaskProject>()
  for (const link of links) {
    const key = taskLocationKey(link)
    if (linked.has(key)) {
      continue
    }
    const project = projectForNote(link.targetPath, link.targetPath, projectNotePaths)
    if (projectNotePaths.has(project.path)) {
      linked.set(key, project)
    }
  }
  return linked
}

/**
 * The project a task groups under in Projects, or null when it is not in that
 * view. A task written inside a project's folder belongs there; otherwise a
 * project its line links wins (a daily note, or a meeting note outside any
 * project folder); otherwise a regular note is its own project.
 */
export function projectForTask(
  task: OpenTask,
  projectNotePaths: ReadonlySet<string>,
  linkedProjects: LinkedTaskProjects = new Map(),
): TaskProject | null {
  const own =
    task.dailyDate === null ? projectForNote(task.notePath, task.noteTitle, projectNotePaths) : null
  if (own !== null && projectNotePaths.has(own.path)) {
    return own
  }
  return linkedProjects.get(taskLocationKey(task)) ?? own
}

/**
 * Which of the Todoist views (not All) a single open task appears in.
 * `linksProject` says the task's own line links a project
 * ({@link linkedProjectsByTask}), which puts a daily-note task in Projects too.
 */
export function taskViewsFor(task: OpenTask, today: string, linksProject = false): TaskView[] {
  const views: TaskView[] = []
  const date = task.dueDate ?? task.dailyDate
  if (date !== null && (task.dueDate !== null ? date <= today : date === today)) {
    views.push('today')
  } else if (date !== null && date > today) {
    views.push('upcoming')
  } else if (task.dueDate === null && task.dailyDate !== null) {
    views.push('inbox')
  }
  if (task.dailyDate === null || linksProject) {
    views.push('projects')
  }
  return views
}

function byPriorityThenPosition(left: OpenTask, right: OpenTask): number {
  const byPriority = compareTaskPriority(taskRawPriority(left.raw), taskRawPriority(right.raw))
  if (byPriority !== 0) {
    return byPriority
  }
  if (left.notePath !== right.notePath) {
    return left.notePath < right.notePath ? -1 : 1
  }
  return left.markerOffset - right.markerOffset
}

function groupToday(tasks: readonly OpenTask[], today: string): TaskGroup[] {
  const overdue: OpenTask[] = []
  const due: OpenTask[] = []
  for (const task of tasks) {
    if (!taskViewsFor(task, today).includes('today')) {
      continue
    }
    if (task.dueDate !== null && task.dueDate < today) {
      overdue.push(task)
    } else {
      due.push(task)
    }
  }
  const groups: TaskGroup[] = []
  if (overdue.length > 0) {
    groups.push({
      kind: 'overdue',
      label: 'Overdue',
      notePath: null,
      tasks: overdue.sort(compareDated),
    })
  }
  groups.push({ kind: 'today', label: 'Today', notePath: null, tasks: due.sort(compareDated) })
  return groups
}

function groupUpcoming(tasks: readonly OpenTask[], today: string): TaskGroup[] {
  const days: TaskGroup[] = []
  const byDate = new Map<string, OpenTask[]>()
  for (let offset = 1; offset <= UPCOMING_DAYS; offset += 1) {
    const date = addDaysIso(today, offset)
    const dayTasks: OpenTask[] = []
    byDate.set(date, dayTasks)
    days.push({ kind: 'day', label: date, notePath: null, date, tasks: dayTasks })
  }
  const later: OpenTask[] = []
  for (const task of tasks) {
    if (!taskViewsFor(task, today).includes('upcoming')) {
      continue
    }
    // Upcoming membership guarantees a date after today.
    const date = (task.dueDate ?? task.dailyDate)!
    const day = byDate.get(date)
    if (day === undefined) {
      later.push(task)
    } else {
      day.push(task)
    }
  }
  for (const day of days) {
    day.tasks.sort(compareDated)
  }
  if (later.length > 0) {
    days.push({ kind: 'later', label: 'Later', notePath: null, tasks: later.sort(compareDated) })
  }
  return days
}

function groupInbox(tasks: readonly OpenTask[], today: string): TaskGroup[] {
  const inbox = tasks
    .filter((task) => taskViewsFor(task, today).includes('inbox'))
    .sort((left, right) => {
      // Inbox membership guarantees a daily date; newest capture first.
      const leftDate = left.dailyDate!
      const rightDate = right.dailyDate!
      if (leftDate !== rightDate) {
        return leftDate < rightDate ? 1 : -1
      }
      return byPriorityThenPosition(left, right)
    })
  return [{ kind: 'inbox', label: 'Inbox', notePath: null, tasks: inbox }]
}

function groupProjects(
  tasks: readonly OpenTask[],
  projectNotePaths: ReadonlySet<string>,
  linkedProjects: LinkedTaskProjects,
): TaskGroup[] {
  const byProject = new Map<string, { project: TaskProject; tasks: OpenTask[] }>()
  for (const task of tasks) {
    const project = projectForTask(task, projectNotePaths, linkedProjects)
    if (project === null) {
      continue
    }
    const entry = byProject.get(project.path)
    if (entry === undefined) {
      byProject.set(project.path, { project, tasks: [task] })
    } else {
      entry.tasks.push(task)
    }
  }
  return [...byProject.values()]
    .map(({ project, tasks: projectTasks }) => {
      // Keep each source note's tasks together, in document order; tasks
      // linked in from daily notes follow the project's own, newest first.
      const sections = projectSections(
        projectTasks.sort(compareProjectTasks),
        project,
        projectNotePaths,
      )
      return {
        kind: 'note' as const,
        label: project.title,
        notePath: project.path,
        tasks: sections.flatMap((section) => section.tasks),
        sections,
      }
    })
    .sort(compareNoteGroups)
}

/**
 * Split a project's sorted tasks by their headings, Todoist-style: tasks above
 * every heading (and tasks linked in from elsewhere, whose heading belongs to
 * another note) come first, unlabeled; then one section per heading, in the
 * order the headings first appear. Order inside a section is kept.
 */
function projectSections(
  tasks: readonly OpenTask[],
  project: TaskProject,
  projectNotePaths: ReadonlySet<string>,
): TaskSection[] {
  const bySection = new Map<string | null, OpenTask[]>([[null, []]])
  for (const task of tasks) {
    const writtenInProject =
      task.dailyDate === null &&
      projectForNote(task.notePath, task.noteTitle, projectNotePaths).path === project.path
    const label = writtenInProject ? task.section : null
    const section = bySection.get(label)
    if (section === undefined) {
      bySection.set(label, [task])
    } else {
      section.push(task)
    }
  }
  return [...bySection]
    .filter(([, sectionTasks]) => sectionTasks.length > 0)
    .map(([label, sectionTasks]) => ({ label, tasks: sectionTasks }))
}

function compareProjectTasks(left: OpenTask, right: OpenTask): number {
  if (left.notePath === right.notePath) {
    return byPriorityThenPosition(left, right)
  }
  const leftDaily = left.dailyDate !== null
  const rightDaily = right.dailyDate !== null
  if (leftDaily !== rightDaily) {
    return leftDaily ? 1 : -1
  }
  if (leftDaily && left.dailyDate !== right.dailyDate) {
    return left.dailyDate! < right.dailyDate! ? 1 : -1
  }
  return left.notePath < right.notePath ? -1 : 1
}

/**
 * Group open (and struck, just-completed) tasks for one Tasks view. `today` is
 * the app's local ISO day; `projectNotePaths` are the graph's folder notes;
 * `linkedProjects` the projects task lines link ({@link linkedProjectsByTask}).
 */
export function groupTasksForView(
  view: TaskView,
  tasks: readonly OpenTask[],
  today: string,
  projectNotePaths: ReadonlySet<string> = new Set(),
  linkedProjects: LinkedTaskProjects = new Map(),
): TaskGroup[] {
  switch (view) {
    case 'today':
      return groupToday(tasks, today)
    case 'upcoming':
      return groupUpcoming(tasks, today)
    case 'inbox':
      return groupInbox(tasks, today)
    case 'projects':
      return groupProjects(tasks, projectNotePaths, linkedProjects)
    case 'all':
      return groupTasks(tasks, today)
  }
}

/** How many tasks each view holds — the navigation's counts. */
export function countTasksByView(
  tasks: readonly OpenTask[],
  today: string,
  linkedProjects: LinkedTaskProjects = new Map(),
): Record<TaskView, number> {
  const counts: Record<TaskView, number> = {
    today: 0,
    upcoming: 0,
    inbox: 0,
    projects: 0,
    all: tasks.length,
  }
  for (const task of tasks) {
    for (const view of taskViewsFor(task, today, linkedProjects.has(taskLocationKey(task)))) {
      counts[view] += 1
    }
  }
  return counts
}
