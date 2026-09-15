import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react'
import { Check, Close, Pencil } from '@/components/icons'
import {
  displayNoteTitle,
  errorMessage,
  noteFileStem,
  type ChatTurn,
  type NoteToolResult,
} from '@reflect/core'
import { Kbd } from '@/components/kbd'
import { Button } from '@/components/ui/button'
import { useApplyNoteEdit } from '@/hooks/use-apply-note-edit'
import { useNoteRow } from '@/hooks/use-note-row'
import { diffLines } from '@/lib/line-diff'
import { cn } from '@/lib/utils'
import type { NoteEditDecisionRecorder } from '@/providers/chat-context'
import { useChatSession } from '@/providers/chat-provider'

/** Every review card carries `data-chat-patch`, so focus can hop between pending ones. */
const CARD_SELECTOR = '[data-chat-patch]'

/**
 * Proposals whose decision is in flight, by tool call. Module-wide rather
 * than per card instance: a card remounted mid-write (switch away and back)
 * still reads as pending, and must not take the same decision twice.
 */
const inFlightDecisions = new Set<string>()

interface ChatNotePatchCardProps {
  result: Extract<NoteToolResult, { tool: 'editNote' }>
  /** The owning turn's status — a decision is taken only once it settled. */
  turnStatus: ChatTurn['status']
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * The review card for one proposed note edit (the `edit_note` tool): the
 * hunk as a line diff, and Accept / Reject. Nothing is written until Accept,
 * which lands the patch through the session-safe body channel and records
 * the decision with the turn; Reject records it alone. Keyboard-first: the
 * first pending card takes focus when its reply settles, Enter accepts,
 * Backspace rejects, and focus then moves on to the next pending card or
 * back to the composer. The card holds its buttons until the owning turn is
 * done: a decision recorded into a streaming turn would be overwritten by
 * its settle-time save.
 */
export function ChatNotePatchCard({
  result,
  turnStatus,
  onOpen,
}: ChatNotePatchCardProps): ReactElement {
  const { bindNoteEditDecision } = useChatSession()
  const applyNoteEdit = useApplyNoteEdit()
  const row = useNoteRow(result.path)
  const title = displayNoteTitle(row?.title ?? noteFileStem(result.path))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sawStreaming = useRef(false)
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const decidable = result.decision === 'pending' && turnStatus === 'done' && !busy
  const diff = diffLines(result.oldText, result.newText)

  // Take focus only for a proposal that just arrived in this session — a
  // restored conversation's old pending card must not grab the keyboard —
  // and only for the first pending card of the reply.
  useEffect(() => {
    if (turnStatus === 'streaming') {
      sawStreaming.current = true
      return
    }
    if (!sawStreaming.current || !decidable) {
      return
    }
    sawStreaming.current = false
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest(CARD_SELECTOR) !== null) {
      return
    }
    rootRef.current?.focus()
  }, [turnStatus, decidable])

  function focusNext(): void {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(`${CARD_SELECTOR}[data-decidable="true"]`),
    )
    const own = rootRef.current
    const next = cards.find((card) => card !== own && own !== null && positionAfter(own, card))
    const target =
      next ?? document.querySelector<HTMLElement>('textarea[aria-label="Chat message"]')
    target?.focus()
  }

  /**
   * Take the proposal's one decision slot, binding its recorder. The check
   * is synchronous, so a second key landing before React re-renders `busy`
   * (Enter then Backspace in one breath) finds the slot taken.
   */
  function claimDecision(): NoteEditDecisionRecorder | null {
    if (!decidable || inFlightDecisions.has(result.toolCallId)) {
      return null
    }
    // Bind the decision's home before any write: a conversation switch or
    // New chat mid-write must not leave an applied edit recorded as pending.
    const record = bindNoteEditDecision(result.toolCallId)
    if (record !== null) {
      inFlightDecisions.add(result.toolCallId)
    }
    return record
  }

  async function accept(): Promise<void> {
    const record = claimDecision()
    if (record === null) {
      return
    }
    setBusy(true)
    setApplyError(null)
    try {
      await applyNoteEdit(result.path, { oldText: result.oldText, newText: result.newText })
      record('accepted')
      focusNext()
    } catch (cause) {
      // A failed apply leaves the proposal pending and open to another try.
      setApplyError(errorMessage(cause))
    } finally {
      inFlightDecisions.delete(result.toolCallId)
      setBusy(false)
    }
  }

  function reject(): void {
    const record = claimDecision()
    if (record === null) {
      return
    }
    record('rejected')
    inFlightDecisions.delete(result.toolCallId)
    focusNext()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Keys on the card itself only — a button inside handles its own Enter.
    if (event.target !== event.currentTarget || !decidable) {
      return
    }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      void accept()
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      reject()
    }
  }

  const verb =
    result.decision === 'accepted'
      ? 'Applied edit to'
      : result.decision === 'rejected'
        ? 'Rejected edit to'
        : 'Proposed edit to'

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${verb} ${title}`}
      tabIndex={0}
      data-chat-patch=""
      data-decidable={decidable ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      className="mt-1 w-full max-w-full rounded-lg border border-border bg-surface-sunken p-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <p className="flex min-w-0 items-center gap-1.5 px-1 pb-1.5 text-xs text-text-muted">
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
      </p>
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
      {applyError !== null ? (
        <p role="alert" className="px-1 pt-1.5 text-xs text-destructive">
          {applyError}
        </p>
      ) : null}
      {result.decision === 'pending' && turnStatus === 'done' ? (
        <div className="flex items-center gap-1.5 px-1 pt-2">
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation()
              void accept()
            }}
          >
            <Check aria-hidden />
            {busy ? 'Applying…' : 'Accept'}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation()
              reject()
            }}
          >
            <Close aria-hidden />
            Reject
          </Button>
          <span
            aria-hidden
            className="ml-auto flex items-center gap-1 text-2xs text-text-muted select-none"
          >
            <Kbd>↵</Kbd> accept <Kbd>⌫</Kbd> reject
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Whether `candidate` follows `reference` in document order. */
function positionAfter(reference: Node, candidate: Node): boolean {
  return (reference.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}
