import { useState, type ReactElement } from 'react'
import { errorMessage } from '@kore/core'
import { Check, Copy } from '@/components/icons'
import { Button } from '@/components/ui/button'

interface CopyButtonProps {
  /** What lands on the clipboard; a function when it has to be fetched first (a keychain token). */
  text: string | (() => Promise<string>)
  label: string
  /**
   * Called with null when a copy starts and with the message when it fails,
   * so a field passes its own `setError`.
   */
  onError: (message: string | null) => void
  variant?: 'default' | 'outline'
}

/**
 * The Settings copy button: copies, then says "Copied" with a check until
 * what it copies changes (or its `key` does). Each button keeps its own
 * state, so a field never tracks which of its buttons was pressed.
 */
export function CopyButton({
  text,
  label,
  onError,
  variant = 'outline',
}: CopyButtonProps): ReactElement {
  // What was copied, so "Copied" clears by itself when the text changes. A
  // fetched value (a function) has nothing to compare: give the button a new
  // `key` when it changes instead.
  const current = typeof text === 'string' ? text : null
  const [copiedText, setCopiedText] = useState<string | null | undefined>(undefined)
  const copied = copiedText === current

  async function copy(): Promise<void> {
    onError(null)
    try {
      await navigator.clipboard.writeText(typeof text === 'string' ? text : await text())
      setCopiedText(current)
    } catch (caught) {
      onError(errorMessage(caught))
    }
  }

  return (
    <Button size="xs" variant={variant} onClick={() => void copy()}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copied' : label}
    </Button>
  )
}
