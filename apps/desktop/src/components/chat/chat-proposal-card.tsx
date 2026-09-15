import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Check, Close } from '@/components/icons'
import { errorMessage, type ChatTurn, type NoteEditDecision } from '@reflect/core'
import { Kbd } from '@/components/kbd'
import { Button } from '@/components/ui/button'
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

interface ChatProposalCardProps {
  toolCallId: string
  decision: NoteEditDecision
  /** The owning turn's status — a decision is taken only once it settled. */
  turnStatus: ChatTurn['status']
  /** The card's accessible name (`Proposed edit to Atlas`, `Set icon of #book`…). */
  label: string
  /** The header line: the tool's glyph, the verb, and the target link. */
  header: ReactNode
  /** The write Accept performs; a rejection keeps the proposal pending and shows the message. */
  onAccept: () => Promise<void>
  children: ReactNode
}

/**
 * The review shell every chat proposal shares — a note edit, a tag icon —
 * with Accept / Reject and the decision plumbing. Nothing is written until
 * Accept, which runs the caller's write and records the decision with the
 * turn; Reject records it alone. Keyboard-first: the first pending card
 * takes focus when its reply settles, Enter accepts, Backspace rejects, and
 * focus then moves on to the next pending card or back to the composer. The
 * card holds its buttons until the owning turn is done: a decision recorded
 * into a streaming turn would be overwritten by its settle-time save.
 */
export function ChatProposalCard({
  toolCallId,
  decision,
  turnStatus,
  label,
  header,
  onAccept,
  children,
}: ChatProposalCardProps): ReactElement {
  const { bindNoteEditDecision } = useChatSession()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sawStreaming = useRef(false)
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const decidable = decision === 'pending' && turnStatus === 'done' && !busy

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
    if (!decidable || inFlightDecisions.has(toolCallId)) {
      return null
    }
    // Bind the decision's home before any write: a conversation switch or
    // New chat mid-write must not leave an applied edit recorded as pending.
    const record = bindNoteEditDecision(toolCallId)
    if (record !== null) {
      inFlightDecisions.add(toolCallId)
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
      await onAccept()
      record('accepted')
      focusNext()
    } catch (cause) {
      // A failed apply leaves the proposal pending and open to another try.
      setApplyError(errorMessage(cause))
    } finally {
      inFlightDecisions.delete(toolCallId)
      setBusy(false)
    }
  }

  function reject(): void {
    const record = claimDecision()
    if (record === null) {
      return
    }
    record('rejected')
    inFlightDecisions.delete(toolCallId)
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

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      tabIndex={0}
      data-chat-patch=""
      data-decidable={decidable ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      className="mt-1 w-full max-w-full rounded-lg border border-border bg-surface-sunken p-2"
    >
      <p className="flex min-w-0 items-center gap-1.5 px-1 pb-1.5 text-xs text-text-muted">
        {header}
      </p>
      {children}
      {applyError !== null ? (
        <p role="alert" className="px-1 pt-1.5 text-xs text-destructive">
          {applyError}
        </p>
      ) : null}
      {decision === 'pending' && turnStatus === 'done' ? (
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
