import { useState, type ComponentProps, type ReactElement } from 'react'
import { Input } from '@/components/ui/input'

interface CommitInputProps extends Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur' | 'onKeyDown'
> {
  value: string
  /** Saves the draft; returns a problem to show instead, or `null`. */
  onCommit: (value: string) => string | null
  /** Shows a validation problem (or clears it with `null`). */
  onProblem?: (problem: string | null) => void
  /** Called with every keystroke, before commit (a live preview). */
  onDraft?: (draft: string | null) => void
}

/**
 * A text field that saves on blur or Enter rather than per keystroke, so a
 * half-typed folder or pattern is never applied. A rejected draft stays in
 * the field until it is fixed.
 */
export function CommitInput({
  value,
  onCommit,
  onProblem,
  onDraft,
  ...props
}: CommitInputProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)

  function commit(): void {
    if (draft === null) {
      return
    }
    const problem = onCommit(draft)
    onProblem?.(problem)
    if (problem === null) {
      setDraft(null)
      onDraft?.(null)
    }
  }

  return (
    <Input
      {...props}
      value={draft ?? value}
      onChange={(event) => {
        setDraft(event.target.value)
        onDraft?.(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}
