import type { ReactElement } from 'react'
import { CloseCircle, Search } from '@/components/icons'

interface FolderTitleFilterProps {
  query: string
  onQueryChange: (query: string) => void
}

/**
 * A folder page's title filter over the listed notes, dressed as one of the
 * header's 28px pills (the sort menu, the layout toggle) rather than a form
 * field, with a clear action once something is typed.
 */
export function FolderTitleFilter({ query, onQueryChange }: FolderTitleFilterProps): ReactElement {
  return (
    <div className="relative flex h-7 w-44 items-center rounded-full bg-surface-hover">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 size-3.5 text-text-muted"
      />
      <input
        type="search"
        aria-label="Filter notes"
        placeholder="Filter notes"
        spellCheck={false}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && query !== '') {
            event.stopPropagation()
            onQueryChange('')
          }
        }}
        className="h-full w-full min-w-0 rounded-full bg-transparent pr-7 pl-8 text-[13px] font-medium text-text outline-none placeholder:font-medium placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {query === '' ? null : (
        <button
          type="button"
          aria-label="Clear filter"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onQueryChange('')}
          className="absolute right-1.5 flex size-4 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
        >
          <CloseCircle aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  )
}
