import type { ReactElement } from 'react'
import type { OpenTask } from '@reflect/core'
import { stripTaskContentPriority, taskContentPriority } from '@reflect/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { taskContent } from '@/lib/tasks/task-content'
import { cn } from '@/lib/utils'

/**
 * Render a task's content (its source line minus the checkbox marker) through
 * Reflect's read-only markdown preview. The focused row swaps this for the
 * inline editor; unfocused rows should look like rendered markdown, not raw
 * source text. A leading priority marker (`!`/`!!`) renders as a colored
 * badge instead of literal bangs — the raw marker stays visible only while
 * editing, like any other markdown syntax.
 */
export function TaskText({ task }: { task: OpenTask }): ReactElement {
  const content = taskContent(task.raw)
  const priority = taskContentPriority(content)
  const preview = (
    <MarkdownPreview
      content={priority === null ? content : stripTaskContentPriority(content)}
      className="reflect-task-preview pointer-events-none text-sm leading-6"
    />
  )
  if (priority === null) {
    return preview
  }
  return (
    <span className="flex items-start gap-1.5">
      <span
        aria-label={priority === 'high' ? 'High priority' : 'Medium priority'}
        title={priority === 'high' ? 'High priority' : 'Medium priority'}
        className={cn(
          // Mono-accent: only high priority speaks in colour (the
          // destructive voice); medium is a firm ink mark, not amber.
          'shrink-0 font-semibold leading-6',
          priority === 'high' ? 'text-destructive' : 'text-text-secondary',
        )}
      >
        {priority === 'high' ? '!!' : '!'}
      </span>
      <span className="min-w-0 flex-1">{preview}</span>
    </span>
  )
}
