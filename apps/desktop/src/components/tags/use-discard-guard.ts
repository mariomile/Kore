import { useState } from 'react'

export interface DiscardGuard {
  /** A close was asked for with unsaved edits: the surface confirms before losing them. */
  discarding: boolean
  /** Close, or ask first when there are unsaved edits. */
  requestClose: () => void
  /** Back out of the confirmation. */
  keepEditing: () => void
}

/**
 * The "discard unsaved changes?" step of the tag settings, shared by the Mac
 * dialog and the iPhone sheet: every way of closing goes through
 * `requestClose`, which closes at once only when nothing was edited.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void): DiscardGuard {
  const [discarding, setDiscarding] = useState(false)
  return {
    discarding,
    requestClose: () => {
      if (dirty) {
        setDiscarding(true)
      } else {
        onClose()
      }
    },
    keepEditing: () => setDiscarding(false),
  }
}
