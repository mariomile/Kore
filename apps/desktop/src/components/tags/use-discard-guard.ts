import { useState } from 'react'

export interface DiscardGuard {
  /** A close was asked for with unsaved edits: the surface confirms before losing them. */
  discarding: boolean
  /** Close, or ask first when there are unsaved edits. */
  requestClose: () => void
  /** Close and then run `then` (leave for another screen); with unsaved edits both wait for {@link discard}. */
  closeThen: (then: () => void) => void
  /** Back out of the confirmation. */
  keepEditing: () => void
  /** Confirm: lose the edits, close, and finish what {@link closeThen} was asked to do. */
  discard: () => void
}

/**
 * The "discard unsaved changes?" step of the tag settings, shared by the Mac
 * dialog and the iPhone sheet: every way of closing goes through
 * `requestClose` or `closeThen`, which close at once only when nothing was
 * edited.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void): DiscardGuard {
  const [pending, setPending] = useState<{ then: (() => void) | null } | null>(null)
  const close = (then: (() => void) | null): void => {
    if (dirty) {
      // A plain close asked while the confirmation is up keeps what was to follow.
      setPending((current) => ({ then: then ?? current?.then ?? null }))
    } else {
      onClose()
      then?.()
    }
  }
  return {
    discarding: pending !== null,
    requestClose: () => close(null),
    closeThen: close,
    keepEditing: () => setPending(null),
    discard: () => {
      onClose()
      pending?.then?.()
    },
  }
}
