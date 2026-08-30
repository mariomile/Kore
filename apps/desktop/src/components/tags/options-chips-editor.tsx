import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { Close } from '@/components/icons'
import { selectOptionBadgeClass } from './select-colors'

interface OptionsChipsEditorProps {
  /** The draft's comma-separated options text (the shape the save path splits). */
  value: string
  onChange: (next: string) => void
}

function parseOptions(value: string): string[] {
  return value
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option !== '')
}

/**
 * Select/status options as removable chips plus an inline add field, in the
 * option's own collection colors ({@link selectOptionBadgeClass}) — the same
 * badge the table and board will show, so authoring previews the result.
 * The draft keeps storing comma-separated text underneath (commas inside an
 * option were never representable there), this only changes how it is edited:
 * Enter or comma commits the pending text, Backspace on an empty field
 * removes the last chip, blur commits what was left half-typed.
 */
export function OptionsChipsEditor({ value, onChange }: OptionsChipsEditorProps): ReactElement {
  const options = parseOptions(value)
  const [pending, setPending] = useState('')

  const commit = (text: string): void => {
    const trimmed = text.trim()
    setPending('')
    if (trimmed === '' || options.includes(trimmed)) {
      return
    }
    onChange([...options, trimmed].join(', '))
  }

  const remove = (option: string): void => {
    onChange(options.filter((entry) => entry !== option).join(', '))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit(pending)
    } else if (event.key === 'Backspace' && pending === '' && options.length > 0) {
      event.preventDefault()
      remove(options[options.length - 1]!)
    }
  }

  return (
    <div className="flex min-h-8 flex-1 flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1">
      {options.map((option) => (
        <span
          key={option}
          className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${selectOptionBadgeClass(option)}`}
        >
          {option}
          <button
            type="button"
            aria-label={`Remove ${option}`}
            onClick={() => remove(option)}
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            <Close aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={pending}
        aria-label="Add option"
        placeholder={options.length === 0 ? 'Add an option…' : undefined}
        className="min-w-24 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        onChange={(event) => setPending(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(pending)}
      />
    </div>
  )
}
