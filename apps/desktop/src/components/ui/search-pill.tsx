import type { ReactElement } from 'react'
import { CloseCircle, Search } from '@/components/icons'
import { cn } from '@/lib/utils'

interface SearchPillProps {
  value: string
  onValueChange: (value: string) => void
  /** The field's accessible name. */
  label: string
  placeholder?: string
  /** Sizing overrides for the pill; it is 176px wide by default. */
  className?: string
}

/**
 * A page header's live filter: one of the 28px pills header chrome is made of
 * (the sort menu, the layout toggle) rather than a form field, with a search
 * glyph and a clear action once something is typed. Esc clears it too.
 */
export function SearchPill({
  value,
  onValueChange,
  label,
  placeholder = label,
  className,
}: SearchPillProps): ReactElement {
  return (
    <div
      className={cn('relative flex h-7 w-44 items-center rounded-full bg-surface-hover', className)}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 size-3.5 text-text-muted"
      />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.stopPropagation()
            onValueChange('')
          }
        }}
        className="h-full w-full min-w-0 rounded-full bg-transparent pr-7 pl-8 text-[13px] font-medium text-text outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value === '' ? null : (
        <button
          type="button"
          aria-label="Clear"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onValueChange('')}
          className="absolute right-1.5 flex size-4 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
        >
          <CloseCircle aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  )
}
