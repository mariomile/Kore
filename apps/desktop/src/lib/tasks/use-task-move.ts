import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OpenTask } from '@reflect/core'
import { useRef } from 'react'
import { toast } from '@/components/ui/toast'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { moveTask, undoTaskMoves, type TaskMove, type TaskMoveTarget } from '@/lib/tasks/task-move'
import { withoutTasks } from '@/lib/tasks/task-cache'
import { useTaskCacheWriter } from '@/lib/tasks/use-task-cache'
import { useGraph } from '@/providers/graph-provider'

export interface TaskMoveActions {
  /** Move the tasks, in order, to `target`; `label` names it in the toast. */
  move: (tasks: OpenTask[], target: TaskMoveTarget, label: string) => void
  /** Undo the last move (⌘Z or the toast's Undo); false when there is none. */
  undo: () => boolean
}

/**
 * "Move to project" for the Tasks view: the rows leave the list at once
 * (optimistic), the notes are rewritten one task at a time, and a toast offers
 * Undo, as ⌘Z does until the next move. A failure part-way reconciles the
 * list with the index, and the moves that did land can still be undone.
 */
export function useTaskMove(): TaskMoveActions {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const cache = useTaskCacheWriter()
  const lastMoves = useRef<TaskMove[]>([])

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: [INDEX_QUERY_SCOPE, graph?.root] })
  }

  const undoMutation = useMutation({
    mutationFn: async (moves: TaskMove[]) => {
      const generation = graph?.generation
      if (generation === undefined) {
        throw new Error('No graph is open.')
      }
      await undoTaskMoves(moves, generation)
    },
    onSettled: refresh,
    onError: (cause) => cache.reconcile('Undoing the move', cause),
  })

  const undo = (): boolean => {
    const moves = lastMoves.current
    if (moves.length === 0 || undoMutation.isPending) {
      return false
    }
    lastMoves.current = []
    undoMutation.mutate(moves)
    return true
  }

  const moveMutation = useMutation({
    mutationFn: async ({
      tasks,
      target,
    }: {
      tasks: OpenTask[]
      target: TaskMoveTarget
      label: string
    }) => {
      const generation = graph?.generation
      if (generation === undefined) {
        throw new Error('No graph is open.')
      }
      lastMoves.current = []
      // One at a time: tasks can share a note, and each move re-locates its
      // task by its line, so an earlier move's shift is tolerated.
      for (const task of tasks) {
        lastMoves.current.push(await moveTask(task, target, generation))
      }
    },
    onMutate: async ({ tasks }) => {
      await cache.snapshot()
      cache.patch(
        (rows) => withoutTasks(rows, tasks),
        (rows) => withoutTasks(rows, tasks),
      )
    },
    onSuccess: (_, { tasks, label }) => {
      const id = toast.add({
        title: tasks.length === 1 ? `Moved to ${label}` : `Moved ${tasks.length} tasks to ${label}`,
        timeout: 8_000,
        actionProps: {
          children: 'Undo',
          onClick: () => {
            toast.close(id)
            undo()
          },
        },
      })
    },
    onError: (cause) => cache.reconcile('Moving tasks', cause),
    onSettled: refresh,
  })

  return {
    move: (tasks, target, label) => moveMutation.mutate({ tasks, target, label }),
    undo,
  }
}
