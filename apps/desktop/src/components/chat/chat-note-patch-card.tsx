import type { MouseEvent, ReactElement } from 'react'
import { Pencil } from '@/components/icons'
import { displayNoteTitle, noteFileStem, type ChatTurn, type NoteToolResult } from '@reflect/core'
import { useApplyNoteEdit } from '@/hooks/use-apply-note-edit'
import { useNoteRow } from '@/hooks/use-note-row'
import { diffLines } from '@/lib/line-diff'
import { cn } from '@/lib/utils'
import { ChatProposalCard } from './chat-proposal-card'

interface ChatNotePatchCardProps {
  result: Extract<NoteToolResult, { tool: 'editNote' }>
  /** The owning turn's status — a decision is taken only once it settled. */
  turnStatus: ChatTurn['status']
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * The review card for one proposed note edit (the `edit_note` tool): the
 * hunk as a line diff inside the shared {@link ChatProposalCard} shell.
 * Accept lands the patch through the session-safe body channel
 * (`useApplyNoteEdit`), re-validated against the note as it is now.
 */
export function ChatNotePatchCard({
  result,
  turnStatus,
  onOpen,
}: ChatNotePatchCardProps): ReactElement {
  const applyNoteEdit = useApplyNoteEdit()
  const row = useNoteRow(result.path)
  const title = displayNoteTitle(row?.title ?? noteFileStem(result.path))
  const diff = diffLines(result.oldText, result.newText)

  const verb =
    result.decision === 'accepted'
      ? 'Applied edit to'
      : result.decision === 'rejected'
        ? 'Rejected edit to'
        : 'Proposed edit to'

  return (
    <ChatProposalCard
      toolCallId={result.toolCallId}
      decision={result.decision}
      turnStatus={turnStatus}
      label={`${verb} ${title}`}
      header={
        <>
          <Pencil aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {verb}{' '}
            <button
              type="button"
              onClick={(event) => onOpen(result.path, event)}
              className="text-text-secondary underline-offset-2 hover:text-text hover:underline"
            >
              {title}
            </button>
          </span>
        </>
      }
      onAccept={() =>
        applyNoteEdit(result.path, { oldText: result.oldText, newText: result.newText })
      }
    >
      <div
        className={cn(
          'max-h-64 overflow-auto rounded-md bg-surface font-mono text-xs leading-5',
          result.decision === 'rejected' && 'opacity-60',
        )}
      >
        {diff.map((line, index) => (
          <div
            key={index}
            className={cn(
              'whitespace-pre-wrap px-1',
              line.kind === 'added' && 'bg-accent/10 text-text',
              line.kind === 'removed' && 'bg-destructive/10 text-destructive',
              line.kind === 'same' && 'text-text-secondary',
            )}
          >
            <span aria-hidden className="mr-2 inline-block w-3 select-none text-text-muted">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            {line.text === '' ? ' ' : line.text}
          </div>
        ))}
      </div>
    </ChatProposalCard>
  )
}
