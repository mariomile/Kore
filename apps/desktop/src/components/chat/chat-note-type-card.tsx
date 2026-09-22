import type { MouseEvent, ReactElement } from 'react'
import { Hash } from '@/components/icons'
import type { ChatTurn, NoteToolResult } from '@reflect/core'
import { useApplyNoteType } from '@/hooks/use-apply-note-type'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { ChatProposalCard } from './chat-proposal-card'

interface ChatNoteTypeCardProps {
  result: Extract<NoteToolResult, { tool: 'setNoteType' }>
  /** The owning turn's status — a decision is taken only once it settled. */
  turnStatus: ChatTurn['status']
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void
}

/** The note's name in the header: its filename, which is its title. */
function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/**
 * The review card for one proposed note type (the `set_note_type` tool):
 * the tag the note would carry, or lose, inside the shared
 * {@link ChatProposalCard} shell. Accept writes the membership through the
 * Type field's own writer (`useApplyNoteType`), re-checked against the note
 * as it is now.
 */
export function ChatNoteTypeCard({
  result,
  turnStatus,
  onOpen,
}: ChatNoteTypeCardProps): ReactElement {
  const applyNoteType = useApplyNoteType()
  const { navigate } = useRouter()

  const verb =
    result.decision === 'accepted'
      ? result.remove
        ? 'Took a type off'
        : 'Set the type of'
      : result.decision === 'rejected'
        ? 'Kept the type of'
        : result.remove
          ? 'Proposed taking a type off'
          : 'Proposed a type for'

  return (
    <ChatProposalCard
      toolCallId={result.toolCallId}
      decision={result.decision}
      turnStatus={turnStatus}
      label={`${verb} ${noteName(result.path)}`}
      header={
        <>
          <Hash aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {verb}{' '}
            <button
              type="button"
              onClick={(event) => onOpen(result.path, event)}
              className="text-text-secondary underline-offset-2 hover:text-text hover:underline"
            >
              {noteName(result.path)}
            </button>
          </span>
        </>
      }
      onAccept={() => applyNoteType({ path: result.path, tag: result.tag, remove: result.remove })}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-xs',
          result.decision === 'rejected' && 'opacity-60',
        )}
      >
        <span className="shrink-0 text-text-muted">{result.remove ? 'Remove' : 'Add'}</span>
        <button
          type="button"
          onClick={() => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag: result.tag } })}
          className={cn(
            'min-w-0 truncate rounded-full border border-border bg-surface-hover px-2 py-0.5 text-text-secondary hover:text-text',
            result.remove && 'line-through',
          )}
        >
          #{result.tag}
        </button>
      </div>
    </ChatProposalCard>
  )
}
