import {
  getProjectNotePaths,
  getTaskProjectLinks,
  linkedProjectsByTask,
  type LinkedTaskProjects,
} from '@kore/core'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { projectNotePathsQueryKey, taskProjectLinksQueryKey } from '@/lib/tasks/tasks-query'

export interface TaskProjects {
  /** The graph's folder notes, as loaded (empty while loading). */
  readonly projectNotes: readonly string[]
  readonly projectNotePaths: ReadonlySet<string>
  /** The project each task's own line links, for Projects and its count. */
  readonly linkedProjects: LinkedTaskProjects
}

/**
 * The project context every Tasks surface shares: the folder notes and the
 * projects task lines link. Both load whenever the surface does, since the
 * Projects count in the view tabs depends on them, not only the open view.
 */
export function useTaskProjects(graphRoot: string | undefined, enabled: boolean): TaskProjects {
  const { data: projectNotes } = useQuery({
    queryKey: projectNotePathsQueryKey(graphRoot),
    queryFn: () => getProjectNotePaths(),
    enabled,
  })
  const { data: links } = useQuery({
    queryKey: taskProjectLinksQueryKey(graphRoot),
    queryFn: () => getTaskProjectLinks(),
    enabled,
  })
  const projectNotePaths = useMemo(() => new Set(projectNotes ?? []), [projectNotes])
  const linkedProjects = useMemo(
    () => linkedProjectsByTask(links ?? [], projectNotePaths),
    [links, projectNotePaths],
  )
  return { projectNotes: projectNotes ?? [], projectNotePaths, linkedProjects }
}
