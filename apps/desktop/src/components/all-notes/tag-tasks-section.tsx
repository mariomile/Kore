import { useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, foldTag, getTasksForTag, type OpenTask } from '@kore/core'
import { ChevronRight } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { useBacklinkNavigation } from '@/hooks/use-backlink-navigation'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { toggleTask } from '@/lib/note-task'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'

interface TagTasksSectionProps {
  /** The routed tag, or `null` off a tag page (renders nothing). */
  tag: string | null
}

/** The row's text without the tag the page is about: on #lead, "call Andrea". */
function rowText(text: string, tagKey: string): string {
  const stripped = text
    .split(/\s+/u)
    .filter((word) => !(word.startsWith('#') && foldTag(word.slice(1)) === tagKey))
    .join(' ')
    .trim()
  return stripped === '' ? text : stripped
}

/**
 * The checkboxes that carry the tag on their own line (organization point
 * 4): `- [ ] call Andrea #lead` written in any note is a row of #lead's
 * database. Open rows are listed and can be ticked off here; done rows sit
 * behind a toggle. Each row names the note it lives in, which opens on
 * click. Renders nothing when no checkbox carries the tag.
 */
export function TagTasksSection({ tag }: TagTasksSectionProps): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const queryClient = useQueryClient()
  const { openSource } = useBacklinkNavigation()
  const [showDone, setShowDone] = useState(false)
  const queryKey = [INDEX_QUERY_SCOPE, graph?.root, 'tag-tasks', tag === null ? '' : foldTag(tag)]
  const { data: rows } = useQuery({
    queryKey,
    queryFn: () => getTasksForTag(tag ?? ''),
    enabled: bridgeReady && graph !== null && tag !== null,
  })

  if (tag === null || rows === undefined || rows.length === 0) {
    return null
  }
  const tagKey = foldTag(tag)
  const open = rows.filter((row) => !row.checked)
  const done = rows.filter((row) => row.checked)

  const toggle = async (row: OpenTask): Promise<void> => {
    if (graph === null) {
      return
    }
    try {
      await toggleTask(row, graph.generation)
      await queryClient.invalidateQueries({ queryKey })
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't update the task",
        description: errorMessage(error),
      })
    }
  }

  const renderRow = (row: OpenTask): ReactElement => (
    <li key={`${row.notePath} ${row.markerOffset}`} className="flex items-start gap-2.5 py-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={row.checked}
        aria-label={`${row.checked ? 'Reopen' : 'Complete'} task: ${row.text}`}
        onClick={() => {
          void toggle(row)
        }}
        className={cn(
          'mt-0.5 size-3.5 shrink-0 rounded-full border transition-colors',
          row.checked
            ? 'border-accent bg-accent'
            : 'border-text-muted/60 hover:border-accent hover:bg-accent-soft',
        )}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span
          className={cn(
            'min-w-0 flex-1 text-sm leading-snug',
            row.checked ? 'text-text-muted line-through' : 'text-text',
          )}
        >
          {rowText(row.text, tagKey)}
        </span>
        {row.dueDate !== null ? (
          <span className="shrink-0 text-xs tabular-nums text-text-muted">{row.dueDate}</span>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            openSource(row.notePath, event)
          }}
          className="max-w-[40%] shrink-0 truncate text-right text-xs text-text-muted hover:text-accent"
        >
          {row.noteTitle}
        </button>
      </span>
    </li>
  )

  return (
    <section aria-label={`Tasks tagged #${tag}`} className="flex-none pb-3 pl-12 pr-7">
      <h2 className="text-xs font-medium text-text-muted">
        {open.length === 0
          ? 'Tasks'
          : `${String(open.length)} open task${open.length === 1 ? '' : 's'}`}
      </h2>
      {open.length > 0 ? <ul className="mt-1 flex flex-col">{open.map(renderRow)}</ul> : null}
      {done.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => {
              setShowDone(!showDone)
            }}
            className="mt-1 flex items-center gap-2 text-left text-xs text-text-muted hover:text-text"
          >
            <ChevronRight
              aria-hidden
              className={`size-3 shrink-0 transition-transform ${showDone ? 'rotate-90' : ''}`}
            />
            <span>{`${String(done.length)} done`}</span>
          </button>
          {showDone ? <ul className="mt-1 flex flex-col pl-5">{done.map(renderRow)}</ul> : null}
        </>
      ) : null}
    </section>
  )
}
