import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { previewNoteMentions } from '@reflect/core'
import { AlertTriangle, Lock, Note } from '@/components/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { CHAT_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

interface ChatDraftMentionsProps {
  /** The composer draft, scanned for `[[…]]` mentions. */
  draft: string
}

/**
 * The notes the draft has hooked, shown as chips above the composer.
 *
 * A `[[…]]` mention resolves to the note's *current content* at send time, so
 * until the message goes out the only feedback was the title the user typed —
 * and a title that resolves to a different note, or to nothing, is only
 * discovered from the answer. Each chip names the note the send will actually
 * attach, with its indexed preview on hover, and flags the two cases where the
 * mention will not carry content: no note by that name, and a private note,
 * whose body the send refuses by design.
 */
export function ChatDraftMentions({ draft }: ChatDraftMentionsProps): ReactElement | null {
  const { graph, indexGeneration } = useGraph()
  const bridgeReady = useBridgeReady()
  const hasMention = draft.includes('[[')
  const { data: mentions } = useQuery({
    queryKey: [CHAT_QUERY_SCOPE, 'draft-mentions', graph?.root, indexGeneration, draft],
    queryFn: () => previewNoteMentions(draft),
    enabled: bridgeReady && indexGeneration !== null && hasMention,
    // The draft is the key, so every keystroke inside a mention would refetch;
    // resolved targets stay good for the length of a compose.
    staleTime: 30_000,
  })

  if (mentions === undefined || mentions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
      {mentions.map((mention) => {
        const missing = mention.path === null
        const label = mention.title ?? mention.target
        const detail = missing
          ? 'No note with this title — the mention sends as plain text.'
          : mention.isPrivate
            ? 'Private note — its content is never sent. Only the title goes out.'
            : mention.preview || 'This note has no preview text yet.'
        return (
          <Tooltip key={mention.target}>
            <TooltipTrigger
              render={
                <span
                  className={
                    missing
                      ? 'flex max-w-56 items-center gap-1.5 rounded-md border border-border border-dashed px-2 py-1 text-xs text-text-muted'
                      : 'flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-text-secondary'
                  }
                >
                  {missing ? (
                    <AlertTriangle aria-hidden className="size-3 shrink-0 text-text-muted" />
                  ) : mention.isPrivate ? (
                    <Lock aria-hidden className="size-3 shrink-0 text-text-muted" />
                  ) : (
                    <Note aria-hidden className="size-3 shrink-0 text-text-muted" />
                  )}
                  <span className="min-w-0 truncate">{label}</span>
                </span>
              }
            />
            <TooltipContent side="top" className="max-w-72">
              {detail}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
