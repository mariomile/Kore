import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { SearchOff } from '@/components/icons'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { NoteRowList } from '@/mobile/note-row-list'
import { rowForHit, useNoteSearchFeed } from '@/mobile/note-search-feed'
import { buildAllNotesSearch, EMPTY_ALL_NOTES_FILTERS } from '@/mobile/search-filters/filter-state'
import { SearchInput } from '@/mobile/search-input'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * Global search on iPhone, opened by pulling down from the top of a screen
 * (Spotlight's gesture): a full-screen sheet over whatever is showing, its
 * field focused, results from the same index query as the All tab's search
 * (so an empty field shows the All tab's recent-first feed straight from its
 * cache). Opening a result closes the sheet and pushes the note; Cancel
 * returns to the screen underneath, untouched.
 */
export function GlobalSearchSheet({ onClose }: { onClose: () => void }): ReactNode {
  // Portaled to the end of <body>: above the shell's status pills, while the
  // row actions' dialogs (portaled later) still land above the sheet.
  return createPortal(<GlobalSearchSurface onClose={onClose} />, document.body)
}

function GlobalSearchSurface({ onClose }: { onClose: () => void }): ReactElement {
  const { navigate } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  // Focus on mount: the sheet exists to type into. The same programmatic
  // focus the tab double-tap uses to raise the keyboard.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const deferredQuery = useDeferredValue(query)
  const parsed = useMemo(
    () => buildAllNotesSearch(deferredQuery, EMPTY_ALL_NOTES_FILTERS, null),
    [deferredQuery],
  )
  const { feed, enabled, isError, removeDeletedRow } = useNoteSearchFeed(parsed)
  const rows = useMemo(() => (feed?.hits ?? []).map(rowForHit), [feed])

  return (
    <div
      ref={scopeRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-x-0 top-0 z-50 flex flex-col bg-surface-app animate-in duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] fade-in-0 slide-in-from-top-4 motion-reduce:animate-none"
      style={
        {
          height: 'calc(100dvh - var(--keyboard-height, 0px))',
          // The sheet covers the tab bar: the result list pads only past the
          // home indicator, not the root's published tab bar height.
          '--mobile-tab-bar-height': 'env(safe-area-inset-bottom)',
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }}
    >
      <header
        ref={barRef}
        className="mobile-glass-bar absolute inset-x-0 top-0 z-30 flex items-center gap-1 px-4 pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <SearchInput
          ref={inputRef}
          placeholder="Search anything…"
          aria-label="Search all notes"
          enterKeyHint="search"
          value={query}
          onValueChange={setQuery}
        />
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 shrink-0 items-center px-2 text-base font-medium text-accent active:opacity-60"
        >
          Cancel
        </button>
      </header>
      {isError ? (
        <Message icon={<SearchOff className="size-6" />} text="Couldn’t search your notes." />
      ) : enabled && feed === undefined ? (
        <div
          className="flex flex-1 items-center justify-center"
          style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
          aria-label="Loading notes"
        >
          <Spinner className="size-5 text-text-muted" />
        </div>
      ) : rows.length === 0 ? (
        <Message
          icon={<SearchOff className="size-6" />}
          text={parsed.text === '' ? 'No notes yet' : 'No matches'}
        />
      ) : (
        <div
          className={cn('flex min-h-0 flex-1 flex-col', query !== deferredQuery && 'opacity-80')}
        >
          <NoteRowList
            rows={rows}
            onOpen={(path) => {
              onClose()
              navigate(routeForPath(path))
            }}
            onDeleted={removeDeletedRow}
          />
        </div>
      )}
    </div>
  )
}

function Message({ icon, text }: { icon: ReactElement; text: string }): ReactElement {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted"
      style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
    >
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  )
}
