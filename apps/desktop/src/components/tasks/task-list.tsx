import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
} from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import type { OpenTask } from '@reflect/core'
import type { InsertTaskTarget } from '@/lib/tasks/task-insert-target'
import { taskKey } from '@/lib/tasks/task-identity'
import { taskListItemKey, type TaskListItem } from '@/lib/tasks/task-list-items'
import type { TaskRowEditHandlers } from '@/lib/tasks/use-task-row-handlers'
import type { TaskSelection } from '@/lib/tasks/use-task-selection'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { TaskBreadcrumbs } from './task-breadcrumbs'
import { TaskGroupHeader } from './task-group-header'
import { TaskRow } from './task-row'

interface TaskListProps {
  /** The flattened rows, in render order — see {@link import('@/lib/tasks/task-list-items').flattenTaskGroups}. */
  items: readonly TaskListItem[]
  selection: TaskSelection
  /** The inline-editor callbacks for a row, built once by the screen. */
  editHandlers: (task: OpenTask) => TaskRowEditHandlers
  /** Whether a Tasks-view write is already in flight. */
  taskActionPending: boolean
  /** Complete/reopen the selected rows using the clicked task's next checkbox state. */
  onSelectionCheckboxToggle: (task: OpenTask) => void
  /** Today's ISO date — the Current group's "+ Add" targets today's daily. */
  today: string
  /** Add a task to a group and open its editor (a header's "+ Add", V1). */
  onAdd: (target: InsertTaskTarget) => void
  /** Holds the editing row's flush-then-convert trigger for the toolbar button. */
  convertControllerRef: MutableRefObject<(() => void) | null>
  onOpen: (notePath: string, event?: ModClickEvent) => void
  /**
   * Hand the screen a way to scroll a flattened row index into view — a
   * virtualized off-screen row isn't in the DOM, so the keyboard nav can't
   * `scrollIntoView` it; only the virtualizer's own `scrollToIndex` reaches an
   * unmounted row. See {@link import('@/lib/use-scroll-to-index-bridge').useScrollToIndexBridge}.
   */
  registerScrollToIndex: (scrollToIndex: (index: number) => void) => void
}

/**
 * The Tasks list: every group's header, breadcrumb, and task row flattened
 * into one virtualized column, so a graph's full completed history (no LIMIT
 * on {@link import('@reflect/core').getCompletedTasks}, by design — the Cmd+A
 * select-all must act on every row) renders as cheaply as a handful of tasks —
 * only the rows the viewport (plus buffer) actually shows ever mount. Rows are
 * variable height (the inline editor swaps a row for a taller one), so the
 * virtualizer measures them rather than assuming a fixed size.
 *
 * A group header loses native `position: sticky` once virtualized — an
 * off-screen header isn't mounted, so it can't stick to the top on its own.
 * V1's pinning is reproduced instead: the currently active group's header is
 * rendered a second time, pinned to the top of the scroll container, but only
 * once its in-flow copy has scrolled out of view. While the in-flow header is
 * still the topmost row (a group's very start), the pinned copy stays hidden
 * — the two would otherwise coincide pixel-for-pixel, and hiding one avoids a
 * second, identically-labelled "Add" button sitting in the DOM.
 */
export function TaskList({
  items,
  selection,
  editHandlers,
  taskActionPending,
  onSelectionCheckboxToggle,
  today,
  onAdd,
  convertControllerRef,
  onOpen,
  registerScrollToIndex,
}: TaskListProps): ReactElement {
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const [topIndex, setTopIndex] = useState(0)

  useEffect(() => {
    registerScrollToIndex((index) => {
      if (index >= 0) {
        virtualizerRef.current?.scrollToIndex(index, { align: 'nearest' })
      }
    })
  }, [registerScrollToIndex])

  const updateTopIndex = useCallback((offset: number) => {
    setTopIndex(virtualizerRef.current?.findItemIndex(offset) ?? 0)
  }, [])

  // Re-derive the pinned group from the current scroll offset — not reset to
  // 0 — whenever the row list changes shape: a filter, search, or completion
  // can reorder or shrink the groups without moving the scroll position.
  useEffect(() => {
    updateTopIndex(virtualizerRef.current?.scrollOffset ?? 0)
  }, [items, updateTopIndex])

  const topItem = items[Math.min(topIndex, items.length - 1)]
  const pinnedGroup = topItem !== undefined && topItem.kind !== 'header' ? topItem.group : null

  return (
    <>
      {pinnedGroup !== null ? (
        // Zero height + `overflow-visible`: the wrapper sticks without adding
        // permanent scroll length of its own — the in-flow header underneath
        // already accounts for that row's height.
        <div className="sticky top-0 z-10 h-0 overflow-visible">
          <TaskGroupHeader group={pinnedGroup} today={today} onAdd={onAdd} onOpen={onOpen} />
        </div>
      ) : null}
      <Virtualizer ref={virtualizerRef} data={items} onScroll={updateTopIndex}>
        {(item, index) => {
          switch (item.kind) {
            case 'header':
              return (
                <div key={taskListItemKey(item)} className={index === 0 ? undefined : 'mt-5'}>
                  <TaskGroupHeader group={item.group} today={today} onAdd={onAdd} onOpen={onOpen} />
                </div>
              )
            case 'empty':
              return (
                <div
                  key={taskListItemKey(item)}
                  className="px-4 py-1.5 text-sm text-text-muted lg:px-12"
                >
                  No tasks
                </div>
              )
            case 'breadcrumb':
              return (
                <TaskBreadcrumbs
                  key={taskListItemKey(item)}
                  breadcrumbs={item.context.visibleBreadcrumbs}
                  onSelect={() => selection.select(item.context.tasks.map(taskKey))}
                />
              )
            case 'task': {
              const key = taskKey(item.task)
              const selected = selection.isSelected(key)
              return (
                <TaskRow
                  key={taskListItemKey(item)}
                  task={item.task}
                  showSource={item.showSource}
                  selected={selected}
                  editing={selection.isSoleSelected(key)}
                  taskActionPending={taskActionPending}
                  togglesSelection={selected && selection.selectedCount > 1}
                  onSelect={(event) => selection.clickSelect(key, event)}
                  onSelectionCheckboxToggle={() => onSelectionCheckboxToggle(item.task)}
                  {...editHandlers(item.task)}
                  convertControllerRef={convertControllerRef}
                  onOpen={onOpen}
                />
              )
            }
          }
        }}
      </Virtualizer>
    </>
  )
}
