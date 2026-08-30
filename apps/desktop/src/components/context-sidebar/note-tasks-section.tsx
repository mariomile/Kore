import type { ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getOpenTasksForNote, type NoteTaskRef } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { toggleTask } from '@/lib/note-task'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { SidebarSection } from './sidebar-section'

interface NoteTasksSectionProps {
  /** Graph-relative path of the note the sidebar describes. */
  path: string
}

/**
 * The note's open tasks: checkboxes written in the note, then tasks anywhere
 * whose own line wiki-links it (`getOpenTasksForNote`) — which is what turns
 * a note into a project page: `+ [ ] call the surveyor [[House]]` captured
 * in a daily note surfaces here, on House. Linked rows name their source
 * note (click to jump there); the checkbox completes through the same
 * commit the Tasks view uses. Hidden while the note has no open tasks —
 * like the outline, an empty panel would be furniture.
 */
export function NoteTasksSection({ path }: NoteTasksSectionProps): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const queryClient = useQueryClient()
  const { navigate } = useRouter()

  const queryKey = [INDEX_QUERY_SCOPE, graph?.root, 'note-tasks', path]
  const { data: tasks } = useQuery({
    queryKey,
    queryFn: () => getOpenTasksForNote(path),
    enabled: bridgeReady && graph !== null,
  })

  if (tasks === undefined || tasks.length === 0) {
    return null
  }

  const complete = async (task: NoteTaskRef): Promise<void> => {
    if (graph === null) {
      return
    }
    try {
      await toggleTask(task, graph.generation)
      // The file write re-indexes and refreshes the whole index scope; this
      // targeted invalidation just makes the row leave without the round trip.
      await queryClient.invalidateQueries({ queryKey })
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't complete the task",
        description: errorMessage(error),
      })
    }
  }

  return (
    <SidebarSection storageKey="note-tasks" title="Tasks">
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li
            key={`${task.notePath} ${task.markerOffset}`}
            className="flex items-start gap-2 px-1.5"
          >
            <button
              type="button"
              aria-label={`Complete task: ${task.text}`}
              onClick={() => {
                void complete(task)
              }}
              className="mt-0.5 size-3.5 shrink-0 rounded-full border border-text-muted/60 transition-colors hover:border-accent hover:bg-accent-soft"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] leading-snug text-text-secondary">{task.text}</span>
              <span className="flex items-center gap-1.5">
                {task.dueDate !== null ? (
                  <span className="text-2xs tabular-nums text-text-muted">{task.dueDate}</span>
                ) : null}
                {task.linked ? (
                  <button
                    type="button"
                    onClick={() => navigate(routeForPath(task.notePath))}
                    className="min-w-0 truncate text-left text-2xs text-text-muted transition-colors hover:text-text-secondary"
                  >
                    {task.noteTitle}
                  </button>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </SidebarSection>
  )
}
